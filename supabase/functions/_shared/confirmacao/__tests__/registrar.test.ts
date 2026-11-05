import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enfileirarSpy } = vi.hoisted(() => ({ enfileirarSpy: vi.fn(async () => 'msg') }));
vi.mock('../../queue.ts', () => ({ enfileirarConfirmacao: enfileirarSpy }));

import { agendarConfirmacao, itemConfirmarCriado, itemConfirmarLegacy, registrarConfirmacao, type ItemConfirmar } from '../registrar';

const ITEM: ItemConfirmar = {
  itemExternoId: 'MLB1', modelo: 'variacoes', capados: 1,
  enviado: { A: { qtd: 10, anterior: 8, variacao_id: '1' } },
};
const ARGS = { orgId: 'org-1', loteId: 'lote-1', familiaId: 'fam-1', codigoPai: '000', enviadoEm: '2026-11-05T12:00:00.000Z' };

function fakeAdmin(resultado: unknown) {
  const upsert = vi.fn(async () => resultado);
  const from = vi.fn(() => ({ upsert }));
  return { admin: { from } as never, from, upsert };
}

beforeEach(() => { enfileirarSpy.mockReset(); enfileirarSpy.mockResolvedValue('msg'); });

describe('registrarConfirmacao (ADR-0195)', () => {
  it('um upsert em lote que zera a conferência anterior', async () => {
    const { admin, from, upsert } = fakeAdmin({ error: null });
    await registrarConfirmacao(admin, { ...ARGS, itens: [ITEM, { ...ITEM, itemExternoId: 'MLB2' }] });
    expect(from).toHaveBeenCalledWith('confirmacoes_ml');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [linhas, opcoes] = upsert.mock.calls[0] as unknown as [Array<Record<string, unknown>>, unknown];
    expect(opcoes).toEqual({ onConflict: 'familia_id,item_externo_id' });
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toEqual({
      org_id: 'org-1', lote_id: 'lote-1', familia_id: 'fam-1', codigo_pai: '000', item_externo_id: 'MLB1',
      modelo: 'variacoes', enviado: ITEM.enviado, capados: 1, enviado_em: ARGS.enviadoEm,
      status: 'aguardando', tentativas: 0, observado: null, divergentes: [], verificado_em: null,
    });
  });

  it('sem itens não toca no banco', async () => {
    const { admin, from } = fakeAdmin({ error: null });
    await registrarConfirmacao(admin, { ...ARGS, itens: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it('erro do banco não lança', async () => {
    const { admin } = fakeAdmin({ error: { message: 'boom' } });
    await expect(registrarConfirmacao(admin, { ...ARGS, itens: [ITEM] })).resolves.toBeUndefined();
  });

  it('exceção do cliente não lança', async () => {
    const admin = { from: () => { throw new Error('boom'); } } as never;
    await expect(registrarConfirmacao(admin, { ...ARGS, itens: [ITEM] })).resolves.toBeUndefined();
  });
});

describe('agendarConfirmacao (ADR-0195)', () => {
  it('enfileira a 1ª leitura com a versão da escrita', async () => {
    await agendarConfirmacao('fam-1', ARGS.enviadoEm);
    expect(enfileirarSpy).toHaveBeenCalledWith({ familia_id: 'fam-1', tentativa: 1, versao: ARGS.enviadoEm });
  });

  it('falha do QStash não lança', async () => {
    enfileirarSpy.mockRejectedValue(new Error('qstash fora'));
    await expect(agendarConfirmacao('fam-1', ARGS.enviadoEm)).resolves.toBeUndefined();
  });
});

describe('itemConfirmarLegacy (ADR-0195)', () => {
  const enviados = { A: { qtd: 100, anterior: 5, variacao_id: '1' }, B: { qtd: 7, anterior: 5, variacao_id: '2' } };

  it('anúncio com variações: capados são os SKUs com saldo maior que o enviado', () => {
    const r = itemConfirmarLegacy('MLB1', { variacoesExternas: { A: '1', B: '2' }, precoVivo: null, enviados }, [
      { codigo: 'A', estoque: 150 }, { codigo: 'B', estoque: 7 }, { codigo: 'C', estoque: 900 },
    ]);
    expect(r).toEqual({ itemExternoId: 'MLB1', modelo: 'variacoes', enviado: enviados, capados: 1 });
  });

  it('item plano: o id externo do SKU é o próprio item', () => {
    const enviado = { A: { qtd: 3, anterior: 5, variacao_id: null } };
    const r = itemConfirmarLegacy('MLB1', { variacoesExternas: { A: 'MLB1' }, precoVivo: null, enviados: enviado }, []);
    expect(r?.modelo).toBe('item');
  });

  it('sem enviados não há o que conferir', () => {
    expect(itemConfirmarLegacy('MLB1', { variacoesExternas: {}, precoVivo: null }, [])).toBeNull();
  });
});

describe('itemConfirmarCriado (ADR-0195)', () => {
  it('guarda o enviado depois do teto, sem saldo anterior, e conta os capados', () => {
    const r = itemConfirmarCriado(
      { itemExternoId: 'MLB1', variacoesExternas: { A: '11', B: '12', C: '13' } },
      [{ sku: 'A', estoque: 80_000 }, { sku: 'B', estoque: 80_000 }, { sku: 'C', estoque: 0 }],
    );
    expect(r).toEqual({
      itemExternoId: 'MLB1', modelo: 'variacoes', capados: 2,
      enviado: {
        A: { qtd: 49_999, anterior: null, variacao_id: '11' },
        B: { qtd: 49_999, anterior: null, variacao_id: '12' },
        C: { qtd: 0, anterior: null, variacao_id: '13' },
      },
    });
  });

  it('dentro do limite: enviado = pedido, capados 0', () => {
    const r = itemConfirmarCriado({ itemExternoId: 'MLB1', variacoesExternas: { A: '11' } }, [{ sku: 'A', estoque: 5 }]);
    expect(r.capados).toBe(0);
    expect(r.enviado.A.qtd).toBe(5);
  });

  it('item plano confere pela raiz; SKU sem vínculo entra sem variação', () => {
    expect(itemConfirmarCriado({ itemExternoId: 'MLB1', variacoesExternas: { A: 'MLB1' } }, [{ sku: 'A', estoque: 5 }]).modelo).toBe('item');
    expect(itemConfirmarCriado({ itemExternoId: 'MLB1', variacoesExternas: {} }, [{ sku: 'A', estoque: 5 }]).enviado.A.variacao_id).toBeNull();
  });
});
