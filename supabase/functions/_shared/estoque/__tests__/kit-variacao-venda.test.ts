import { describe, it, expect } from 'vitest';
import { estornarVendaCancelada, kitsManuaisZerados, refBaixa, registrarBaixaVenda } from '../baixa.ts';
import { agendarCancelamentoKit } from '../cancelamento.ts';

// ADR-0197 (Task 8): venda e cancelamento de SKU de kit com variação. O kit tem saldo próprio, então a
// venda baixa o próprio SKU (o predicado do ADR-0151 é `kit_multiplicador`, nulo aqui).

interface Chamada { tabela: string; op: string; filtros: Array<[string, string, unknown]>; patch?: unknown }

/** Builder encadeável: `dados[tabela]` responde a leitura; toda chamada fica registrada. */
function fakeAdmin(dados: Record<string, unknown[]>, rpcs: Record<string, (args: Record<string, unknown>) => unknown>) {
  const chamadas: Chamada[] = [];
  const rpcChamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const from = (tabela: string) => {
    const c: Chamada = { tabela, op: 'select', filtros: [] };
    chamadas.push(c);
    const resposta = () => ({ data: dados[tabela] ?? [], error: null });
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q,
      update: (patch: unknown) => { c.op = 'update'; c.patch = patch; return q; },
      insert: () => Promise.resolve({ error: null }),
      eq: (k: string, v: unknown) => { c.filtros.push(['eq', k, v]); return q; },
      neq: (k: string, v: unknown) => { c.filtros.push(['neq', k, v]); return q; },
      in: (k: string, v: unknown) => { c.filtros.push(['in', k, v]); return q; },
      is: (k: string, v: unknown) => { c.filtros.push(['is', k, v]); return q; },
      not: () => q,
      lt: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data: (dados[tabela] ?? [])[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve(resposta()).then(res),
    };
    return q;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcChamadas.push({ fn, args });
    return Promise.resolve({ data: rpcs[fn]?.(args) ?? null, error: null });
  };
  // deno-lint-ignore no-explicit-any
  return { admin: { from, rpc } as any, chamadas, rpcChamadas };
}

describe('venda de kit com variação', () => {
  it('baixa só o SKU do kit, ×1, e aponta o saldo zerado', async () => {
    const { admin, rpcChamadas } = fakeAdmin(
      { variacoes: [{ familias: { codigo_pai: 'KITPAI', kit_base_codigo_pai: null, kit_multiplicador: null } }] },
      {
        baixar_estoque: (a) => ({
          aplicado: true, motivo: 'venda', movimento_id: 'm1', estoque_anterior: 2,
          quantidade_pedida: a.p_qtd, quantidade_aplicada: a.p_qtd,
        }),
      },
    );
    const r = await registrarBaixaVenda(admin, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 55, itens: [{ codigo: 'KIT-PB-M', quantity: 2 }],
    });
    const baixas = rpcChamadas.filter((c) => c.fn === 'baixar_estoque');
    expect(baixas).toHaveLength(1);
    expect(baixas[0].args).toMatchObject({ p_codigo: 'KIT-PB-M', p_qtd: 2, p_ref: refBaixa('mercado_livre', 55, 'KIT-PB-M') });
    expect(r.zerados).toEqual(['KIT-PB-M']);
  });

  it('saldo que não chega a zero não entra em zerados', async () => {
    const { admin } = fakeAdmin(
      { variacoes: [{ familias: { codigo_pai: 'P', kit_base_codigo_pai: null, kit_multiplicador: null } }] },
      { baixar_estoque: () => ({ aplicado: true, motivo: 'venda', estoque_anterior: 5, quantidade_pedida: 1, quantidade_aplicada: 1 }) },
    );
    const r = await registrarBaixaVenda(admin, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 56, itens: [{ codigo: 'A', quantity: 1 }],
    });
    expect(r.zerados).toEqual([]);
  });
});

describe('kitsManuaisZerados', () => {
  it('só SKU de kit com reposição automática desligada', async () => {
    const { admin } = fakeAdmin({
      kit_variacao_skus: [
        { codigo: 'KIT-A', kits_variacao: { reposicao_auto: false } },
        { codigo: 'KIT-B', kits_variacao: { reposicao_auto: true } },
      ],
    }, {});
    expect(await kitsManuaisZerados(admin, 'org-1', ['KIT-A', 'KIT-B', 'COMUM'])).toEqual(['KIT-A']);
  });

  it('lista vazia não consulta', async () => {
    const { admin, chamadas } = fakeAdmin({}, {});
    expect(await kitsManuaisZerados(admin, 'org-1', [])).toEqual([]);
    expect(chamadas).toEqual([]);
  });
});

describe('estornarVendaCancelada', () => {
  it('devolve os SKUs creditados nesta execução', async () => {
    const { admin } = fakeAdmin({}, {
      estornar_estoque: (a) => (a.p_codigo === 'A'
        ? { aplicado: true, motivo: 'estorno_venda' }
        : { aplicado: false, motivo: 'duplicata' }),
    });
    const r = await estornarVendaCancelada(admin, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 9,
      itens: [{ codigo: 'A', quantity: 1 }, { codigo: 'B', quantity: 1 }],
    });
    expect(r.aplicados).toEqual(['A']);
  });
});

describe('agendarCancelamentoKit', () => {
  const ITENS = [
    { sku: 'KIT-PB-M', item_externo_id: 'MLB1', user_product_id: 'UP1', catalog_listing_id: 'MLB9' },
  ];

  it('cria transferência cancelamento por kit, enfileira e tira o estorno do push', async () => {
    const enfileirados: string[] = [];
    const { admin, rpcChamadas, chamadas } = fakeAdmin({
      kit_variacao_skus: [{ codigo: 'KIT-PB-M', kit_id: 'kit-1' }],
      anuncios_externos_itens: ITENS,
      estoque_movimentos: [{ id: 'est-1' }],
    }, { kit_criar_transferencia: () => ({ ok: true, id: 't-1' }) });
    const ids = await agendarCancelamentoKit(admin, (id) => { enfileirados.push(id); return Promise.resolve(); }, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['KIT-PB-M', 'COMP-P'],
    });
    expect(rpcChamadas[0]).toEqual({
      fn: 'kit_criar_transferencia',
      args: {
        p_org: 'org-1', p_kit: 'kit-1', p_tipo: 'cancelamento',
        p_itens: [{ codigo: 'KIT-PB-M', quantidade: 0 }],
        p_alvos: [{ codigo: 'KIT-PB-M', up_id: 'UP1', item_ids: ['MLB1', 'MLB9'] }],
      },
    });
    expect(enfileirados).toEqual(['t-1']);
    expect(ids).toEqual(['est-1']);
    const marca = chamadas.find((c) => c.tabela === 'estoque_movimentos' && c.op === 'update');
    expect(marca?.filtros).toContainEqual(['in', 'referencia_externa', [`estorno:${refBaixa('mercado_livre', 77, 'KIT-PB-M')}`]]);
    // Item retirado não é alvo.
    const leitura = chamadas.find((c) => c.tabela === 'anuncios_externos_itens');
    expect(leitura?.filtros).toContainEqual(['eq', 'retirado', false]);
  });

  it('SKU retirado (sem item vivo): sem transferência, o estorno fica no push', async () => {
    const { admin, rpcChamadas } = fakeAdmin({
      kit_variacao_skus: [{ codigo: 'KIT-PB-M', kit_id: 'kit-1' }],
      anuncios_externos_itens: [],
    }, {});
    expect(await agendarCancelamentoKit(admin, () => Promise.resolve(), {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['KIT-PB-M'],
    })).toEqual([]);
    expect(rpcChamadas).toEqual([]);
  });

  it('transferência recusada (up_ocupado): nada marcado, o outbox segue', async () => {
    const { admin, chamadas } = fakeAdmin({
      kit_variacao_skus: [{ codigo: 'KIT-PB-M', kit_id: 'kit-1' }],
      anuncios_externos_itens: ITENS,
    }, { kit_criar_transferencia: () => ({ ok: false, motivo: 'up_ocupado' }) });
    expect(await agendarCancelamentoKit(admin, () => Promise.resolve(), {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['KIT-PB-M'],
    })).toEqual([]);
    expect(chamadas.some((c) => c.op === 'update')).toBe(false);
  });

  it('componente individual (não é SKU de kit) não vira transferência cancelamento', async () => {
    const { admin, rpcChamadas } = fakeAdmin({ kit_variacao_skus: [] }, {});
    expect(await agendarCancelamentoKit(admin, () => Promise.resolve(), {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['COMP-P'],
    })).toEqual([]);
    expect(rpcChamadas).toEqual([]);
  });
});
