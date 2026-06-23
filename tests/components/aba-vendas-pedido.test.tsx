/**
 * Task 3 — AbaVendas renderiza pedidos (por pack/order_id agrupado).
 * Verifica: KPIs novos (pedidos, unidades, markup, compradores), filtro por status de envio,
 * coluna Markup na tabela, e que cada pack aparece como 1 linha.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AbaVendas } from '@/components/faturamento/aba-vendas';
import type { Venda } from '@/lib/faturamento';

// ── mocks de infra ──────────────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock('@/lib/faturamento', async (importActual) => {
  const real = await importActual<typeof import('@/lib/faturamento')>();
  return { ...real, sincronizarFaturamento: vi.fn().mockResolvedValue({ sincronizados: 0 }) };
});

// ── fixture: 2 pedidos (1 normal + 1 pack de 2 vendas com mesmo pack_id) ──
const BASE_ITEM = {
  id: 'i1', ml_item_id: 'MLB1', variation_id: null,
  titulo: 'Produto A', codigo: 'PA01', cor: 'Azul', ean: '123',
  quantity: 1, unit_price: 100, sale_fee: 11, is_publiai: true,
};
const VENDA1: Venda = {
  id: 'v1', order_id: 1001, pack_id: null,
  status: 'paid', status_detail: null,
  date_closed: '2026-06-20T10:00:00Z', date_created: '2026-06-20T09:00:00Z',
  comprador_id: 42, comprador_nick: 'comprador.a',
  total_amount: 100, paid_amount: 100, sale_fee_total: 11,
  frete_vendedor: 5, liquido: 84,
  currency: 'BRL', shipping_id: 9001, shipping_status: 'delivered',
  shipping_substatus: null, tracking_number: 'BR123',
  is_publiai: true, tem_devolucao: false,
  itens: [BASE_ITEM],
};
// Pack com 2 vendas do mesmo pack_id → deve renderizar como 1 linha
const VENDA2A: Venda = {
  ...VENDA1, id: 'v2a', order_id: 1002, pack_id: 5000,
  comprador_id: 99, comprador_nick: 'comprador.b',
  date_closed: '2026-06-21T10:00:00Z',
  shipping_status: 'ready_to_ship',
  itens: [{ ...BASE_ITEM, id: 'i2a', quantity: 2 }],
};
const VENDA2B: Venda = {
  ...VENDA1, id: 'v2b', order_id: 1003, pack_id: 5000,
  comprador_id: 99, comprador_nick: 'comprador.b',
  date_closed: '2026-06-21T11:00:00Z',
  shipping_status: 'ready_to_ship',
  itens: [{ ...BASE_ITEM, id: 'i2b', quantity: 1 }],
};

let mockVendas: Venda[] = [];

vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => ({ data: mockVendas, isFetching: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useCustos', () => ({
  useCustos: () => ({ data: undefined }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function renderAba() {
  return render(<AbaVendas />);
}

describe('AbaVendas — visão por pedido', () => {
  beforeEach(() => {
    mockVendas = [VENDA1, VENDA2A, VENDA2B];
  });

  it('agrupa pack em 1 linha: 3 vendas → 2 pedidos na tabela', () => {
    renderAba();
    // Cada linha de pedido exibe o nick do comprador; comprador.b deve aparecer 1× (não 2×)
    const linhasCompradorB = screen.getAllByText('comprador.b');
    expect(linhasCompradorB).toHaveLength(1);
    const linhasCompradorA = screen.getAllByText('comprador.a');
    expect(linhasCompradorA).toHaveLength(1);
  });

  it('KPI Pedidos mostra 2 (não 3)', () => {
    renderAba();
    // Localizar o card "Pedidos" pelo rótulo e verificar o valor numérico ao lado
    const rotuloPedidos = screen.getByText('Pedidos');
    // O valor fica num sibling/parent próximo — buscar pelo container do card
    const cardPedidos = rotuloPedidos.closest('div[class*="rounded"]') ?? rotuloPedidos.parentElement?.parentElement;
    expect(cardPedidos?.textContent).toContain('2');
  });

  it('KPI Unidades soma os itens de todos os pedidos faturáveis', () => {
    renderAba();
    // VENDA1: 1 un, VENDA2A+VENDA2B: 2+1=3 un → total 4
    const rotuloUnidades = screen.getByText('Unidades');
    const cardUnidades = rotuloUnidades.closest('div[class*="rounded"]') ?? rotuloUnidades.parentElement?.parentElement;
    expect(cardUnidades?.textContent).toContain('4');
  });

  it('KPI Compradores únicos mostra 2', () => {
    renderAba();
    const rotulo = screen.getByText('Compradores');
    const card = rotulo.closest('div[class*="rounded"]') ?? rotulo.parentElement?.parentElement;
    expect(card?.textContent).toContain('2');
  });

  it('tabela tem coluna Markup no header', () => {
    renderAba();
    expect(screen.getByRole('button', { name: /ordenar por markup/i })).toBeInTheDocument();
  });

  it('filtro por status de envio: clicar em "Entregue" exibe só VENDA1', () => {
    renderAba();
    // O card de status de envio tem os status clicáveis. "Entregue" vem de VENDA1.
    const btnEntregue = screen.getByRole('button', { name: /entregue/i });
    fireEvent.click(btnEntregue);
    // Após filtro: só comprador.a deve aparecer (pedido entregue)
    expect(screen.getByText('comprador.a')).toBeInTheDocument();
    expect(screen.queryByText('comprador.b')).not.toBeInTheDocument();
  });

  it('filtro por status: clicar no mesmo status novamente remove o filtro (toggle)', () => {
    renderAba();
    const btnEntregue = screen.getByRole('button', { name: /entregue/i });
    fireEvent.click(btnEntregue); // ativa
    fireEvent.click(btnEntregue); // desativa
    expect(screen.getByText('comprador.a')).toBeInTheDocument();
    expect(screen.getByText('comprador.b')).toBeInTheDocument();
  });

  it('detalhe do produto (código PA01) aparece SÓ ao expandir a linha do pedido', () => {
    renderAba();
    // Antes de expandir: código do produto não deve estar no DOM
    // (a linha do pedido mostra comprador, valor, markup etc. — nunca o código do item)
    expect(screen.queryByText('PA01')).toBeNull();

    // Clica na linha do pedido para expandir (onClick está na TableRow inteira)
    fireEvent.click(screen.getByText('comprador.a'));

    // Após expandir: código do produto aparece na subtabela de detalhe
    expect(screen.getByText('PA01')).toBeInTheDocument();
  });
});
