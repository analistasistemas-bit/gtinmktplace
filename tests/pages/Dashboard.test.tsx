import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Dashboard from '@/pages/Dashboard';
import type { Venda, VendaItem } from '@/lib/faturamento';

vi.mock('@/components/faturamento/mapa-brasil', () => ({ MapaBrasil: () => <div /> }));
vi.mock('@/components/dashboard/grafico-cockpit', () => ({ GraficoCockpit: () => <div /> }));

const resumo = {
  bruto: 100,
  liquido: 90,
  descontos: 10,
  estornos: 0,
  pedidos: 2,
  unidades: 2,
  ticket: 50,
  markup: 0.2,
  lucro: 111,
  liberado: 0,
  aLiberar: 0,
  proximaLiberacao: null,
  comissao: 5,
  frete: 5,
  imposto: 0,
  vendasComCusto: 1,
  totalVendas: 2,
  margem: 0.1,
  porItem: {},
  vendas: [],
};

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'Produto',
    codigo: null, cor: null, ean: null, quantity: 1, unit_price: 10,
    sale_fee: 0, is_publiai: true, ...over,
  };
}

function venda(over: Partial<Venda> = {}): Venda {
  return {
    id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-06-15T00:00:00Z', date_created: null, comprador_nick: 'cliente',
    comprador_id: 100, comprador_nome: 'Cliente Teste', total_amount: 10, paid_amount: 10,
    sale_fee_total: 1, frete_vendedor: null, liquido: 9, estorno: null,
    money_release_date: null, sacado_em: null, sacado_por: null, currency: 'BRL',
    shipping_id: null, shipping_status: null, shipping_substatus: null,
    shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, uf: null, cidade: null, itens: [item()], ...over,
  };
}

vi.mock('@/hooks/useResumoVendas', () => ({
  useResumoVendas: () => ({ resumo, isFetching: false, error: null }),
}));
vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => ({
    data: [
      venda({ id: 'a', order_id: 1, total_amount: 50, liquido: 40, itens: [item({ id: 'a1', unit_price: 50 })] }),
      venda({ id: 'b', order_id: 2, total_amount: 25, liquido: 20, itens: [item({ id: 'b1', unit_price: 25 })] }),
    ],
    isPending: false,
  }),
}));
vi.mock('@/hooks/useCustos', () => ({
  useCustos: () => ({
    data: {
      porVariacao: new Map(),
      porItem: new Map([['MLB1', { custo: 1, peso: 0, origem: 'nacional' }]]),
      porGtin: new Map(),
    },
  }),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 10, importado: 20 } }),
}));
vi.mock('@/hooks/useLotes', () => ({ useLotes: () => ({ data: [] }) }));
vi.mock('@/hooks/usePublicados', () => ({ usePublicados: () => ({ data: [] }) }));
vi.mock('@/hooks/useStatusPublicados', () => ({ useStatusPublicados: () => ({ data: { itens: [], semCredencialML: false } }) }));
vi.mock('@/hooks/usePerguntas', () => ({ usePerguntasNaoRespondidas: () => ({ data: 0 }) }));
vi.mock('@/hooks/useDevolucoes', () => ({ useDevolucoes: () => ({ data: [] }) }));

describe('Dashboard', () => {
  it('prioriza líquido no card antes usado para lucro líquido', () => {
    render(<Dashboard />, { wrapper: MemoryRouter });

    expect(screen.getByText('Líquido no faturamento')).toBeInTheDocument();
    expect(screen.getByText('R$ 52,50')).toBeInTheDocument();
    expect(screen.getByText('lucro R$ 111,00')).toBeInTheDocument();
    expect(screen.queryByText('Lucro líquido')).not.toBeInTheDocument();
  });
});
