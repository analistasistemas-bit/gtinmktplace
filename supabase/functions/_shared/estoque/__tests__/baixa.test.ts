import { describe, it, expect } from 'vitest';
import { selecionarBaixas, refBaixa, selecionarSemSku, refSemSku, registrarBaixaVenda } from '../baixa';

describe('selecionarBaixas', () => {
  it('ignora item sem codigo', () => {
    expect(selecionarBaixas([{ codigo: null, quantity: 2 }])).toEqual([]);
  });

  it('ignora quantity <= 0', () => {
    expect(selecionarBaixas([
      { codigo: 'A1', quantity: 0 },
      { codigo: 'A2', quantity: -1 },
    ])).toEqual([]);
  });

  it('mantém item válido', () => {
    expect(selecionarBaixas([{ codigo: '02835002RS', quantity: 3 }]))
      .toEqual([{ codigo: '02835002RS', quantity: 3 }]);
  });

  it('agrega o mesmo sku repetido no mesmo pedido', () => {
    expect(selecionarBaixas([
      { codigo: 'A1', quantity: 1 },
      { codigo: 'A1', quantity: 2 },
    ])).toEqual([{ codigo: 'A1', quantity: 3 }]);
  });

  it('preserva a ordem de primeira aparição', () => {
    expect(selecionarBaixas([
      { codigo: 'B', quantity: 1 },
      { codigo: 'A', quantity: 1 },
      { codigo: 'B', quantity: 1 },
    ])).toEqual([{ codigo: 'B', quantity: 2 }, { codigo: 'A', quantity: 1 }]);
  });

  it('lista vazia devolve vazio', () => {
    expect(selecionarBaixas([])).toEqual([]);
  });
});

describe('refBaixa', () => {
  it('é canal-agnóstica por construção — o canal entra na chave', () => {
    expect(refBaixa('mercado_livre', 123, 'A1')).toBe('mercado_livre:123:A1');
    expect(refBaixa('shopee', 123, 'A1')).toBe('shopee:123:A1');
  });

  it('aceita orderId string ou número sem mudar a chave', () => {
    expect(refBaixa('mercado_livre', '123', 'A1')).toBe(refBaixa('mercado_livre', 123, 'A1'));
  });
});

// Incidente 2026-08-11 (org DSA): 12 unidades venderam sem baixar e sem deixar rastro, porque
// o item sem código era descartado calado por selecionarBaixas.
describe('selecionarSemSku', () => {
  it('separa os itens de venda paga que não têm SKU resolvido', () => {
    expect(selecionarSemSku([
      { codigo: 'A1', quantity: 1 },
      { codigo: null, quantity: 2, ml_item_id: 'MLB1', titulo: 'Sabonete' },
    ])).toEqual([{ codigo: null, quantity: 2, ml_item_id: 'MLB1', titulo: 'Sabonete' }]);
  });

  it('não considera item sem código e sem quantidade', () => {
    expect(selecionarSemSku([{ codigo: null, quantity: 0 }])).toEqual([]);
  });

  it('pedido inteiro com SKU não gera diagnóstico', () => {
    expect(selecionarSemSku([{ codigo: 'A1', quantity: 1 }])).toEqual([]);
  });
});

describe('refSemSku', () => {
  it('é única por (canal, pedido, item externo)', () => {
    expect(refSemSku('mercado_livre', 123, 'MLB1')).toBe('venda_sem_sku:mercado_livre:123:MLB1');
    expect(refSemSku('mercado_livre', 123, 'MLB2'))
      .not.toBe(refSemSku('mercado_livre', 123, 'MLB1'));
  });

  it('item sem id ainda gera chave estável — o sync roda várias vezes por pedido', () => {
    expect(refSemSku('mercado_livre', 123, null)).toBe('venda_sem_sku:mercado_livre:123:sem-item');
    expect(refSemSku('mercado_livre', 123, null)).toBe(refSemSku('mercado_livre', 123, null));
  });
});

describe('registrarBaixaVenda — venda sem SKU', () => {
  function adminFake(over: {
    insertErro?: { code: string; message: string };
    rpc?: { aplicado: boolean; motivo: string };
  } = {}) {
    const inserts: Record<string, unknown>[] = [];
    return {
      inserts,
      from: () => ({
        insert: (linha: Record<string, unknown>) => {
          inserts.push(linha);
          return Promise.resolve({ error: over.insertErro ?? null });
        },
        select: () => ({
          eq: () => ({
            is: () => ({
              neq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
            }),
          }),
        }),
      }),
      // A RPC real sempre devolve jsonb; `aplicado: false` = já baixado antes (idempotência).
      rpc: () => Promise.resolve({
        data: over.rpc ?? { aplicado: false, motivo: 'duplicata' },
        error: null,
      }),
    };
  }

  const pedido = {
    orgId: 'org1', canal: 'mercado_livre', orderId: 999,
    itens: [{ codigo: null, quantity: 3, ml_item_id: 'MLB7389260688', titulo: 'NIVEA Sabonete' }],
  };

  it('grava movimento informativo no ledger em vez de descartar em silêncio', async () => {
    const admin = adminFake();
    const r = await registrarBaixaVenda(admin as never, pedido);
    expect(admin.inserts).toHaveLength(1);
    expect(admin.inserts[0]).toMatchObject({
      org_id: 'org1',
      motivo: 'venda_sku_nao_encontrado',
      quantidade: 0,
      quantidade_pedida: 3,
      codigo_pai: '',
      referencia_externa: 'venda_sem_sku:mercado_livre:999:MLB7389260688',
    });
    expect(r.semSku).toEqual([{ titulo: 'NIVEA Sabonete', mlItemId: 'MLB7389260688', quantidade: 3 }]);
  });

  // codigo_pai vazio mantém o movimento fora do índice de outbox: sem produto resolvido não
  // existe para onde empurrar estoque.
  it('o diagnóstico nunca vira push', async () => {
    const admin = adminFake();
    await registrarBaixaVenda(admin as never, pedido);
    expect(admin.inserts[0].codigo_pai).toBe('');
    expect(admin.inserts[0].push_enfileirado_em).toBeTruthy();
  });

  it('duplicata (23505) é o caminho normal — o sync roda várias vezes por pedido', async () => {
    const admin = adminFake({ insertErro: { code: '23505', message: 'duplicate key' } });
    const r = await registrarBaixaVenda(admin as never, pedido);
    expect(r.semSku).toHaveLength(1);
  });

  it('erro real no insert não derruba a baixa nem reporta o item como registrado', async () => {
    const admin = adminFake({ insertErro: { code: '42501', message: 'permission denied' } });
    const r = await registrarBaixaVenda(admin as never, pedido);
    expect(r.semSku).toEqual([]);
  });

  it('pedido só com SKU válido não grava diagnóstico nenhum', async () => {
    const admin = adminFake();
    await registrarBaixaVenda(admin as never, {
      ...pedido, itens: [{ codigo: 'A1', quantity: 1 }],
    });
    expect(admin.inserts).toHaveLength(0);
  });
});

// Incidente 2026-08-13 (linha Xik, cor Azul): a variação sumiu do banco mas seguiu vendendo no
// ML. O pedido trazia o SKU (seller_custom_field), então o item NÃO era "sem SKU" — a RPC
// devolvia `sku_nao_encontrado` e o laço seguia calado. Um SKU que o catálogo não conhece é
// exatamente o caso em que só o operador pode agir.
describe('registrarBaixaVenda — SKU desconhecido pelo catálogo', () => {
  function adminFake(rpc: { aplicado: boolean; motivo: string }) {
    return {
      from: () => ({
        insert: () => Promise.resolve({ error: null }),
        select: () => ({
          eq: () => ({
            is: () => ({
              neq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
            }),
          }),
        }),
      }),
      rpc: () => Promise.resolve({ data: rpc, error: null }),
    };
  }

  const pedido = {
    orgId: 'org1', canal: 'mercado_livre', orderId: 999,
    itens: [{ codigo: '00220809', quantity: 2, ml_item_id: 'MLB7010890734', titulo: 'Linha Azul' }],
  };

  it('reporta o SKU que a RPC não achou no catálogo', async () => {
    const admin = adminFake({ aplicado: false, motivo: 'sku_nao_encontrado' });
    const r = await registrarBaixaVenda(admin as never, pedido);
    expect(r.skuDesconhecido).toEqual([{ codigo: '00220809', quantidade: 2 }]);
  });

  it('duplicata (já baixado antes) não vira alerta de SKU desconhecido', async () => {
    const admin = adminFake({ aplicado: false, motivo: 'duplicata' });
    const r = await registrarBaixaVenda(admin as never, pedido);
    expect(r.skuDesconhecido).toEqual([]);
  });

  it('baixa aplicada não vira alerta', async () => {
    const admin = adminFake({ aplicado: true, motivo: 'venda' });
    const r = await registrarBaixaVenda(admin as never, pedido);
    expect(r.skuDesconhecido).toEqual([]);
  });
});
