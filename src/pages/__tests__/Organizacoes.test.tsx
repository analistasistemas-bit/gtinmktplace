import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { invoke, requestSupport, cancelSupport, listSupportRequests, start, usePlatformWallet } = vi.hoisted(() => ({
  invoke: vi.fn(), requestSupport: vi.fn(), cancelSupport: vi.fn(), listSupportRequests: vi.fn(), start: vi.fn(),
  usePlatformWallet: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/suporte', () => ({ requestSupport, cancelSupport, listSupportRequests }));
vi.mock('@/stores/support-store', () => ({ useSupportStore: (selector: (state: { start: typeof start }) => unknown) => selector({ start }) }));
vi.mock('@/hooks/usePlatformAdmin', () => ({ usePlatformWallet }));

import Organizacoes from '../Organizacoes';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const makeOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  nome: 'Cliente',
  slug: 'cliente',
  is_test: false,
  modality: 1,
  metrics: {
    org_id: 'org-1',
    month: '2026-09',
    gross_cents: 150_000,
    orders: 5,
    ticket_cents: 30_000,
    markup: 2.1,
    cost_covered_orders: 4,
    total_orders: 5,
    active_ads: null,
    publications: null,
    pending_operations: 1,
    updated_at: null,
    previous: { gross_cents: 100_000, orders: 4, markup: 2 },
    series: [],
    warnings: [],
  },
  forecast_cents: 200_000,
  billable_units: 8,
  daludi_searches: 2,
  pending_count: 1,
  ...overrides,
});

const makeTotals = (overrides: Record<string, unknown> = {}) => ({
  gross_cents: 150_000,
  forecast_cents: 200_000,
  orgs_without_terms: 0,
  org_count: 1,
  pending_count: 1,
  orders: 5,
  warnings: [],
  ...overrides,
});

const makeWallet = (rows: ReturnType<typeof makeOrg>[], overrides: Record<string, unknown> = {}) => ({
  data: { rows, total: rows.length, page: 1, page_size: 10, totals: makeTotals({ org_count: rows.length }) },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  usePlatformWallet.mockReturnValue(makeWallet([makeOrg()]));
  listSupportRequests.mockResolvedValue({ requests: [], total: 0, page: 1, pageSize: 50 });
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}

function renderPage(initialEntry = '/admin?mes=2026-09') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/admin" element={<Organizacoes />} />
          <Route path="/admin/organizacoes/:orgId" element={<LocationProbe />} />
          <Route path="/" element={<p>Operação</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Organizacoes', () => {
  it('solicita acesso somente leitura com motivo e identifica tenant de teste', async () => {
    usePlatformWallet.mockReturnValue(makeWallet([makeOrg({ id: 'sandbox', nome: 'Sandbox', slug: 'sandbox', is_test: true })]));
    requestSupport.mockResolvedValue({ id: 'request-1', status: 'pending' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('checkbox', { name: 'Incluir testes' }));
    expect(await screen.findByText('Teste')).toBeInTheDocument();
    // "Solicitar acesso" foi para dentro do menu "Ações" (redesign T8) — abrir antes de clicar.
    await user.click(screen.getByRole('button', { name: 'Ações' }));
    await user.click(await screen.findByText('Solicitar acesso'));
    await user.type(screen.getByLabelText('Motivo do acesso'), 'Verificar falha de integração');
    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    await waitFor(() => expect(requestSupport).toHaveBeenCalledWith({
      orgId: 'sandbox', scope: 'read', reason: 'Verificar falha de integração',
    }));
  });

  it('permite entrar só com aprovação ainda utilizável', async () => {
    listSupportRequests.mockResolvedValue({ requests: [{ id: 'request-1', org_id: 'org-1', status: 'approved', scope: 'full', approval_expires_at: new Date(Date.now() + 60_000).toISOString() }], total: 1, page: 1, pageSize: 50 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Entrar na operação' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('request-1'));
  });

  it('preserva o pedido mais recente por organização e só oferece renovação nos 15 minutos finais', async () => {
    usePlatformWallet.mockReturnValue(makeWallet([makeOrg({ id: 'org-2' })]));
    listSupportRequests.mockResolvedValue({ requests: [
      { id: 'new', org_id: 'org-2', status: 'active', scope: 'read', expires_at: new Date(Date.now() + 10 * 60_000).toISOString() },
      { id: 'old', org_id: 'org-2', status: 'approved', scope: 'full', approval_expires_at: new Date(Date.now() + 60_000).toISOString() },
    ], total: 2, page: 1, pageSize: 50 });
    renderPage();
    await screen.findByText('Cliente');
    await waitFor(() => expect(listSupportRequests).toHaveBeenCalledWith({ page: 1, pageSize: 50, status: 'actionable' }));
    expect(screen.getByRole('button', { name: 'Solicitar renovação' })).toBeInTheDocument();
  });

  it('mantém o cancelamento visível e bloqueia cliques repetidos enquanto processa', async () => {
    usePlatformWallet.mockReturnValue(makeWallet([makeOrg({ id: 'org-3' })]));
    listSupportRequests.mockResolvedValue({ requests: [{ id: 'request-3', org_id: 'org-3', status: 'pending', scope: 'read' }], total: 1, page: 1, pageSize: 50 });
    cancelSupport.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole('button', { name: 'Cancelar solicitação' });
    await user.click(button);

    expect(cancelSupport).toHaveBeenCalledWith('request-3');
    expect(screen.getByRole('button', { name: 'Cancelando…' })).toBeDisabled();
  });

  it('mostra a carteira, formata markup como percentual e navega mantendo o mês', async () => {
    usePlatformWallet.mockReturnValue(makeWallet([makeOrg({ id: 'avil', nome: 'Avil', slug: 'avil', metrics: { ...makeOrg().metrics, markup: 0.43 } })]));
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('heading', { name: 'Organizações' })).toBeInTheDocument();
    expect(screen.getByText('Markup')).toBeInTheDocument();
    expect(screen.getByText('+43%')).toBeInTheDocument();
    expect(screen.queryByText('Indisponível')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Ver organização Avil/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/organizacoes/avil?mes=2026-09');
  });

  it('filtra organizações de teste e exibe falha do backend', async () => {
    usePlatformWallet.mockReturnValue(makeWallet(
      [makeOrg({ id: 'test', nome: 'Org teste', is_test: true })],
      { isError: true, data: undefined },
    ));
    renderPage();

    expect(screen.queryByText('Org teste')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a carteira');
    expect(usePlatformWallet).toHaveBeenCalledWith(expect.objectContaining({ include_test: false }));
  });

  it('org sem condições comerciais ganha pill "Sem condições" e item "Cadastrar" na faixa de atenção', async () => {
    usePlatformWallet.mockReturnValue(makeWallet([makeOrg({
      id: 'sem-termos', nome: 'SemTermos', slug: 'sem-termos', modality: null, forecast_cents: null, pending_count: null,
    })]));
    renderPage();

    expect(await screen.findByText('Sem condições')).toBeInTheDocument();
    expect(screen.getByText('Precisa da sua atenção')).toBeInTheDocument();
    expect(screen.getByText('SemTermos sem condições comerciais')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cadastrar/i })).toBeInTheDocument();
  });

  it('organização com pendências mostra a pílula com a contagem', async () => {
    usePlatformWallet.mockReturnValue(makeWallet([makeOrg({ pending_count: 2 })]));
    renderPage();

    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  // A contagem usava `?? 0` e afirmava "0 organizações" enquanto carregava — e também no erro,
  // logo acima da faixa vermelha, onde soa como "a carteira está vazia" em vez de "falhou".
  it.each([
    ['carregando', { data: undefined, isLoading: true }],
    ['em erro', { data: undefined, isLoading: false, isError: true }],
  ])('não afirma contagem de organizações quando está %s', (_estado, override) => {
    usePlatformWallet.mockReturnValue({ refetch: vi.fn(), isError: false, ...override });

    renderPage();

    expect(screen.queryByText(/organizações · ordenadas por/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 organizações/)).not.toBeInTheDocument();
  });

  it('nenhuma org com condição comercial: Previsão de cobrança vira — (nunca R$ 0,00)', async () => {
    const org = makeOrg({ id: 'sem-termos', nome: 'SemTermos', modality: null, forecast_cents: null, pending_count: null });
    usePlatformWallet.mockReturnValue(makeWallet([org], {
      data: {
        rows: [org], total: 1, page: 1, page_size: 10,
        totals: makeTotals({ forecast_cents: 0, orgs_without_terms: 1, org_count: 1 }),
      },
    }));
    renderPage();

    expect(await screen.findByTitle('Nenhuma organização tem condição comercial vigente — sem base para prever')).toBeInTheDocument();
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });

  it('orgs com condição comercial somando zero: Previsão de cobrança continua R$ 0,00', async () => {
    const org = makeOrg({ forecast_cents: 0 });
    usePlatformWallet.mockReturnValue(makeWallet([org], {
      data: {
        rows: [org], total: 1, page: 1, page_size: 10,
        totals: makeTotals({ forecast_cents: 0, orgs_without_terms: 0, org_count: 1 }),
      },
    }));
    renderPage();

    // "R$ 0,00" aparece tanto no KPI quanto na coluna "Previsão" da linha — ambos legítimos aqui.
    expect((await screen.findAllByText('R$ 0,00')).length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Nenhuma organização tem condição comercial vigente — sem base para prever')).not.toBeInTheDocument();
  });

  it('debounca a busca: digitar várias teclas não dispara uma chamada por caractere', () => {
    vi.useFakeTimers();
    renderPage();
    const input = screen.getByLabelText('Buscar organizações');

    // Intervalos < 300ms entre teclas: se o timer da tecla anterior não fosse cancelado
    // (clearTimeout ausente), ele dispararia sozinho e vazaria um valor intermediário ('a', 'av')
    // para o hook antes do valor final.
    fireEvent.change(input, { target: { value: 'a' } });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.change(input, { target: { value: 'av' } });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.change(input, { target: { value: 'avil' } });

    // Ainda dentro da janela de debounce da última tecla: nenhum valor de busca chegou ao hook.
    const searchesDuringTyping = usePlatformWallet.mock.calls.map(([params]) => params.search);
    expect(searchesDuringTyping.every((value) => value === undefined)).toBe(true);

    act(() => { vi.advanceTimersByTime(299); });
    expect(usePlatformWallet).not.toHaveBeenCalledWith(expect.objectContaining({ search: expect.any(String) }));

    act(() => { vi.advanceTimersByTime(1); });
    expect(usePlatformWallet).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'avil' }));

    // Só o valor final chegou ao hook — nenhum 'a' ou 'av' intermediário vazou de um timer não cancelado.
    const searchValuesSeen = new Set(usePlatformWallet.mock.calls.map(([params]) => params.search).filter((value) => value !== undefined));
    expect(searchValuesSeen).toEqual(new Set(['avil']));
  });
});
