// O mapa canônico (ADR-0021/0045) chega numa query separada de `useVendas`. Enquanto ele não
// assenta, a venda entrada pelo anúncio de CATÁLOGO ainda está na chave do MLB de catálogo, não na
// do anúncio dono — a linha de Publicados mostraria a fatia própria e depois saltaria. Daí o
// `canonicoPronto`. O que este teste trava: (1) o flag reflete "assentou" e trata erro como
// assentado (senão a coluna ficaria "—" para sempre); (2) os KPIs agregados NÃO são segurados por
// ele — zerar o resumo enquanto o mapa não chega piscaria R$ 0,00 no Dashboard/Financeiro.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Venda, VendaItem } from '@/lib/faturamento';

const { estadoCanonico, vendasFake } = vi.hoisted(() => ({
  estadoCanonico: { data: undefined as unknown, isSuccess: false, isError: false },
  vendasFake: { atual: [] as unknown[] },
}));

vi.mock('../useVendas', () => ({
  useVendas: () => ({
    data: vendasFake.atual, isFetching: false, isError: false, dataUpdatedAt: 0, refetch: vi.fn(),
  }),
}));
vi.mock('../useCustos', () => ({ useCustos: () => ({ data: undefined, isError: false }) }));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 }, isError: false }),
}));
vi.mock('../useAnuncioCanonico', () => ({ useAnuncioCanonico: () => estadoCanonico }));

const { useResumoVendas } = await import('../useResumoVendas');

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'MEU', variation_id: null, titulo: 'Protetor Eucerin', codigo: '00000005',
  cor: null, ean: null, quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, ...over,
});
const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 100, paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: 100, estorno: null, money_release_date: null,
  sacado_em: null, sacado_por: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: true, tem_devolucao: false,
  uf: null, cidade: null, itens: [], atualizado_em: '2026-06-20T00:00:00Z', ...over,
});

// Uma venda pelo anúncio próprio e outra pelo de catálogo — o caso do Eucerin em produção.
const vendas: Venda[] = [
  venda({ id: 'a', order_id: 1, total_amount: 100, liquido: 100, itens: [item({ ml_item_id: 'MEU' })] }),
  venda({ id: 'b', order_id: 2, total_amount: 100, liquido: 100, itens: [item({ ml_item_id: 'CATALOGO' })] }),
];

const janela = { desde: '2026-06-01T00:00:00.000Z', ate: '2026-06-30T23:59:59.999Z' };

function montar(canonico: { data?: unknown; isSuccess: boolean; isError: boolean }) {
  vendasFake.atual = vendas;
  Object.assign(estadoCanonico, { data: undefined, ...canonico });
  return renderHook(() => useResumoVendas(janela)).result.current;
}

describe('useResumoVendas — canonicoPronto', () => {
  it('mapa ainda carregando: flag false, mas os KPIs agregados já saem calculados', () => {
    const r = montar({ isSuccess: false, isError: false });
    expect(r.canonicoPronto).toBe(false);
    // Segurar o resumo aqui piscaria zero em KPI financeiro (Dashboard tira o loading do
    // useVendas, não deste hook) — os agregados não dependem do mapa.
    expect(r.resumo.bruto).toBe(200);
    expect(r.resumo.unidades).toBe(2);
  });

  it('mapa resolvido: flag true e a venda de catálogo soma na chave do anúncio dono', () => {
    const r = montar({ data: { CATALOGO: 'MEU' }, isSuccess: true, isError: false });
    expect(r.canonicoPronto).toBe(true);
    expect(r.resumo.porItem.MEU.unidades).toBe(2);
    expect(r.resumo.porItem.CATALOGO).toBeUndefined();
  });

  it('mapa em erro: flag true (degrada para o comportamento sem mapa, não trava a coluna)', () => {
    const r = montar({ isSuccess: false, isError: true });
    expect(r.canonicoPronto).toBe(true);
    expect(r.resumo.porItem.MEU.unidades).toBe(1);
    expect(r.resumo.porItem.CATALOGO.unidades).toBe(1);
  });
});
