// ADR-0208: com erro em `useAliquotas`, o resumo de vendas não aplica imposto algum — nem 8/16, nem o
// `data` antigo que o React Query mantém num refetch com falha (as vigências de hoje podem ter mudado).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { montarMapasCusto } from '@/lib/custos';
import type { Venda, VendaItem } from '@/lib/faturamento';

const { aliqQ, vendasFake } = vi.hoisted(() => ({
  aliqQ: { data: undefined as unknown, isError: false },
  vendasFake: { atual: [] as unknown[] },
}));

const mapas = montarMapasCusto([
  { custo: 40, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: null,
    atualizado_em: '2026-01-01', familias: { ml_item_id: 'MLB1', origem: 'nacional' } },
]);

vi.mock('../useVendas', () => ({
  useVendas: () => ({ data: vendasFake.atual, isFetching: false, isError: false, dataUpdatedAt: 0, refetch: vi.fn() }),
}));
vi.mock('../useCustos', () => ({ useCustos: () => ({ data: mapas, isError: false }) }));
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
  beforeEach(() => { vendasFake.atual = [venda]; });

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

  it('isError sem data: sem imposto (100 − 40 = 60), nunca o 8% de fallback (52)', () => {
    Object.assign(aliqQ, { data: undefined, isError: true });
    const r = lucro();
    expect(r.resumo.lucro).toBe(60);
    expect(r.error).toBe(true);
  });

  it('isError com data antigo (refetch falhou): ignora o cache — sem imposto (60), não 56', () => {
    Object.assign(aliqQ, { data: { nacional: 4, importado: 16 }, isError: true });
    const r = lucro();
    expect(r.resumo.lucro).toBe(60);
    expect(r.error).toBe(true);
  });
});
