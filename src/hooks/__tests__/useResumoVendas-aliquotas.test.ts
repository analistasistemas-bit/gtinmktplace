// ADR-0208: com erro em `useAliquotas`, o resumo de vendas não aplica imposto algum — nem 8/16, nem o
// `data` antigo que o React Query mantém num refetch com falha (as vigências de hoje podem ter mudado).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { montarMapasCusto } from '@/lib/custos';
import type { Venda, VendaItem } from '@/lib/faturamento';

const { aliqQ, custosQ, vendasRefetch, vendasFake } = vi.hoisted(() => ({
  aliqQ: { data: undefined as unknown, isError: false, refetch: vi.fn() },
  custosQ: { isError: false, refetch: vi.fn() },
  vendasRefetch: vi.fn(),
  vendasFake: { atual: [] as unknown[] },
}));

const mapas = montarMapasCusto([
  { custo: 40, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: null,
    atualizado_em: '2026-01-01', familias: { ml_item_id: 'MLB1', origem: 'nacional' } },
]);

vi.mock('../useVendas', () => ({
  useVendas: () => ({ data: vendasFake.atual, isFetching: false, isError: false, dataUpdatedAt: 0, refetch: vendasRefetch }),
}));
vi.mock('../useCustos', () => ({ useCustos: () => ({ data: mapas, isError: custosQ.isError, refetch: custosQ.refetch }) }));
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliqQ }));
vi.mock('../useAnuncioCanonico', () => ({ useAnuncioCanonico: () => ({ data: undefined, isSuccess: true, isError: false }) }));

const { useResumoVendas } = await import('../useResumoVendas');

const item: VendaItem = {
  id: 'i', ml_item_id: 'MLB1', variation_id: null, titulo: 't', codigo: '1', cor: null, ean: null,
  quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true,
};
const venda = { id: 'x', order_id: 1, pack_id: null, status: 'paid', date_closed: '2026-10-05T15:00:00Z',
  date_created: '2026-10-05T15:00:00Z', total_amount: 100, liquido: 100, sale_fee_total: 0, estorno: null,
  uf: 'SP', itens: [item] } as unknown as Venda;

const janela = { desde: '2026-10-01T00:00:00.000Z', ate: '2026-10-31T23:59:59.999Z' };
const lucro = () => renderHook(() => useResumoVendas(janela)).result.current;

describe('useResumoVendas — erro nas alíquotas (ADR-0208)', () => {
  beforeEach(() => {
    vendasFake.atual = [venda];
    Object.assign(aliqQ, { data: undefined, isError: false });
    custosQ.isError = false;
    vendasRefetch.mockClear();
    custosQ.refetch.mockClear();
    aliqQ.refetch.mockClear();
  });

  it('com alíquota carregada: imposto entra no lucro (100 − 4 − 40 = 56)', () => {
    Object.assign(aliqQ, { data: { nacional: 4, importado: 16 }, isError: false });
    expect(lucro().resumo.lucro).toBe(56);
  });

  it('vigência da época: venda de outubro usa 4%, não os 6,5% de hoje', () => {
    Object.assign(aliqQ, { data: { nacional: 6.5, importado: 16, vigencias: [
      { vigenteDesde: '1970-01-01T00:00:00Z', nacional: 4, importado: 16, ufEmpresa: null, internaPct: null },
      { vigenteDesde: '2026-11-01T00:00:00Z', nacional: 6.5, importado: 16, ufEmpresa: null, internaPct: null },
    ] }, isError: false });
    expect(lucro().resumo.lucro).toBe(56);
  });

  it('isError sem data: não publica lucro, markup nem margem (imposto 0 não vira resultado)', () => {
    Object.assign(aliqQ, { data: undefined, isError: true });
    const r = lucro();
    expect(r.resumo.lucro).toBeNull();
    expect(r.resumo.markup).toBeNull();
    expect(r.resumo.margem).toBeNull();
    expect(r.error).toBe(true);
    expect(r.erroMensagem).toBe('Falha ao ler as alíquotas de imposto.');
  });

  it('isError com data antigo (refetch falhou): também não publica lucro com o cache', () => {
    Object.assign(aliqQ, { data: { nacional: 4, importado: 16 }, isError: true });
    const r = lucro();
    expect(r.resumo.lucro).toBeNull();
    expect(r.resumo.markup).toBeNull();
    expect(r.resumo.margem).toBeNull();
    expect(r.erroMensagem).toBe('Falha ao ler as alíquotas de imposto.');
  });

  it('erro nos custos: não publica lucro e a mensagem nomeia os custos, não as vendas', () => {
    Object.assign(aliqQ, { data: { nacional: 4, importado: 16 }, isError: false });
    custosQ.isError = true;
    const r = lucro();
    expect(r.resumo.lucro).toBeNull();
    expect(r.resumo.markup).toBeNull();
    expect(r.resumo.margem).toBeNull();
    expect(r.erroMensagem).toBe('Falha ao ler os custos.');
  });

  it('refetch refaz vendas, custos e alíquotas', () => {
    Object.assign(aliqQ, { data: { nacional: 4, importado: 16 }, isError: false });
    lucro().refetch();
    expect(vendasRefetch).toHaveBeenCalledTimes(1);
    expect(custosQ.refetch).toHaveBeenCalledTimes(1);
    expect(aliqQ.refetch).toHaveBeenCalledTimes(1);
  });
});
