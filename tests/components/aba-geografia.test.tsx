import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AbaGeografia } from '@/components/faturamento/aba-geografia';
import type { Venda } from '@/lib/faturamento';

// ── mocks de infra ──────────────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

// ── fixture: 3 vendas com UFs diferentes ──────────────────────────────────
const BASE_ITEM = {
  id: 'i1', ml_item_id: 'MLB1', variation_id: null,
  titulo: 'Produto A', codigo: 'PA01', cor: 'Azul', ean: '123',
  quantity: 2, unit_price: 100, sale_fee: 11, is_publiai: true,
};

const VENDA_SP: Venda = {
  id: 'v1', order_id: 1001, pack_id: null,
  status: 'paid', status_detail: null,
  date_closed: '2026-06-20T10:00:00Z', date_created: '2026-06-20T09:00:00Z',
  comprador_id: 1, comprador_nick: 'comprador.sp',
  uf: 'SP', cidade: 'São Paulo',
  total_amount: 200, paid_amount: 200, sale_fee_total: 22,
  frete_vendedor: 5, liquido: 173,
  estorno: null, money_release_date: null,
  currency: 'BRL', shipping_id: 9001,
  shipping_status: 'delivered', shipping_substatus: null,
  shipping_logistic: null, tracking_number: 'BR001',
  is_publiai: true, tem_devolucao: false,
  itens: [BASE_ITEM],
};

const VENDA_SP2: Venda = {
  ...VENDA_SP, id: 'v2', order_id: 1002,
  comprador_id: 2, comprador_nick: 'comprador.sp2',
  date_closed: '2026-06-21T10:00:00Z',
  cidade: 'Campinas',
};

const VENDA_PE: Venda = {
  ...VENDA_SP, id: 'v3', order_id: 1003,
  comprador_id: 3, comprador_nick: 'comprador.pe',
  uf: 'PE', cidade: 'Recife',
  date_closed: '2026-06-22T10:00:00Z',
};

let mockVendas: Venda[] = [];

vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => ({ data: mockVendas, isFetching: false, refetch: vi.fn() }),
}));

function renderAba() {
  return render(<AbaGeografia />);
}

describe('AbaGeografia', () => {
  beforeEach(() => {
    mockVendas = [VENDA_SP, VENDA_SP2, VENDA_PE];
  });

  it('renderiza o mapa com paths de estado (data-uf)', () => {
    const { container } = renderAba();
    const paths = container.querySelectorAll('[data-uf]');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('KPI "Estados atingidos" aparece no DOM', () => {
    renderAba();
    expect(screen.getByText('Estados atingidos')).toBeInTheDocument();
  });

  it('mostra 2 estados atingidos (SP e PE)', () => {
    renderAba();
    const rotuloEstados = screen.getByText('Estados atingidos');
    const card = rotuloEstados.closest('div[class*="rounded"]') ?? rotuloEstados.parentElement?.parentElement;
    expect(card?.textContent).toContain('2');
  });

  it('mostra o top estado (SP com 2 pedidos)', () => {
    renderAba();
    // SP tem 2 pedidos vs PE com 1 → deve ser o top
    const rotuloTop = screen.getByText('Top estado');
    const card = rotuloTop.closest('div[class*="rounded"]') ?? rotuloTop.parentElement?.parentElement;
    expect(card?.textContent).toContain('SP');
  });

  it('tabela top estados lista SP e PE', () => {
    renderAba();
    expect(screen.getByText('Top estados')).toBeInTheDocument();
    // SP e PE aparecem nas linhas da tabela
    const spCells = screen.getAllByText('SP');
    expect(spCells.length).toBeGreaterThan(0);
    const peCells = screen.getAllByText('PE');
    expect(peCells.length).toBeGreaterThan(0);
  });

  it('tabela top cidades lista São Paulo e Recife', () => {
    renderAba();
    expect(screen.getByText('Top cidades')).toBeInTheDocument();
    expect(screen.getByText('São Paulo')).toBeInTheDocument();
    expect(screen.getByText('Recife')).toBeInTheDocument();
  });

  it('empty state quando sem vendas faturáveis', () => {
    mockVendas = [];
    renderAba();
    expect(screen.getByText(/nenhuma venda com localização/i)).toBeInTheDocument();
  });

  it('não exibe "Carregando…" quando isFetching é false (mock padrão)', () => {
    mockVendas = [];
    renderAba();
    // Com isFetching:false o estado de loading não deve aparecer
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
  });
});
