// O diálogo de confirmação de saque anuncia quantidade e valor de uma ação sobre dinheiro. Os ids
// enviados à RPC são congelados no clique, então os números do diálogo precisam vir da MESMA foto:
// `useVendas` faz poll de 3min e refetch ao focar a aba (ADR-0081/0082), e recalcular em render
// deixaria o título divergir do que a RPC recebe.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DetalheFinanceiro from '../DetalheFinanceiro';
import { useVendas } from '@/hooks/useVendas';
import type { Venda, VendaItem } from '@/lib/faturamento';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/useVendas', () => ({ useVendas: vi.fn() }));
vi.mock('@/hooks/useDevolucoes', () => ({ useDevolucoes: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/useCustos', () => ({ useCustos: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useCoresProduto', () => ({ useCoresProduto: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useNomesUsuarios', () => ({ useNomesUsuarios: () => ({ data: new Map() }) }));
vi.mock('@/hooks/useAnuncioCanonico', () => ({ useAnuncioCanonico: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => ({ data: null, isLoading: false }) }));
vi.mock('@/lib/faturamento', async (orig) => ({
  ...(await orig<typeof import('@/lib/faturamento')>()),
  registrarSaque: vi.fn().mockResolvedValue(undefined),
  desfazerSaque: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/components/export/botao-exportar', () => ({ BotaoExportar: () => null }));
// Corta a cadeia jspdf/html2canvas do adapter de export: montar a página inteira só para
// abrir um diálogo não justifica ~20s de transform no worker.
vi.mock('@/lib/export/adapters', () => ({ buildFinanceiroDetalheReport: vi.fn() }));

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: '001', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over,
  };
}

/** Venda liberada (money_release_date no passado, sem saque) — elegível a "Registrar saque". */
function venda(i: number, over: Partial<Venda> = {}): Venda {
  return {
    id: `v${i}`, order_id: i + 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-08-01T00:00:00Z', date_created: null, comprador_nick: `c${i}`,
    comprador_nome: null, comprador_id: i + 1, uf: null, cidade: null,
    total_amount: 100, paid_amount: 100, sale_fee_total: 10, frete_vendedor: null, liquido: 90,
    estorno: null, money_release_date: '2026-08-01T00:00:00Z', sacado_em: null, sacado_por: null,
    atualizado_em: '2026-08-01T00:00:00Z', currency: 'BRL', shipping_id: null,
    shipping_status: null, shipping_substatus: null, shipping_logistic: null,
    tracking_number: null, is_publiai: true, tem_devolucao: false,
    itens: [item({ id: `it${i}` })],
    ...over,
  } as unknown as Venda;
}

const vendasDe = (n: number) => Array.from({ length: n }, (_, i) => venda(i));

/** Mesmo universo, mas as `sacadas` primeiras já foram sacadas por outro operador. */
const vendasComSaque = (n: number, sacadas: number) =>
  Array.from({ length: n }, (_, i) =>
    venda(i, i < sacadas ? { sacado_em: '2026-08-02T00:00:00Z', sacado_por: 'outro' } : {}));

function mockVendas(vendas: Venda[]) {
  vi.mocked(useVendas).mockReturnValue({
    data: vendas, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(),
  } as never);
}

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function tela() {
  return (
    <MemoryRouter initialEntries={['/financeiro/detalhe?dias=30']}>
      <QueryClientProvider client={queryClient()}>
        <DetalheFinanceiro />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('DetalheFinanceiro — confirmação de saque em massa', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(useVendas).mockReset();
  });

  it('congela quantidade do diálogo: pedido sacado por outro operador durante a confirmação não muda o anunciado', async () => {
    // 25 > LIMITE_CONFIRMA_SAQUE (20), então "Registrar saque" abre a confirmação.
    mockVendas(vendasDe(25));
    const user = userEvent.setup();
    const { rerender } = render(tela());

    await user.click(screen.getByLabelText('Selecionar todos os pedidos do filtro'));
    await user.click(screen.getByRole('button', { name: /Registrar saque/ }));

    expect(await screen.findByText(/Registrar saque de 25 pedidos\?/)).toBeInTheDocument();

    // Com o diálogo aberto, o poll de 3min traz 8 dos pedidos MARCADOS já sacados por outro
    // operador da org. Sem congelar, o título recalcularia para 17 enquanto o botão ainda manda
    // os 25 ids do clique.
    mockVendas(vendasComSaque(25, 8));
    rerender(tela());

    expect(screen.getByText(/Registrar saque de 25 pedidos\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Registrar saque de 17 pedidos\?/)).not.toBeInTheDocument();
  });
});
