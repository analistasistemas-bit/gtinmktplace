import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PainelAlertas } from '../painel-alertas';
import { QK } from '@/lib/queries';
import { fetchPulseAlertas, type PulseAlerta } from '@/lib/pulse';

const marcarAlertasLidos = vi.fn(async (_severidade: string) => undefined);

vi.mock('@/lib/pulse', async () => {
  const real = await vi.importActual<typeof import('@/lib/pulse')>('@/lib/pulse');
  return {
    ...real,
    // react-query trata queryFn que resolve `undefined` como erro — sempre precisa de um array.
    fetchPulseAlertas: vi.fn(async () => []),
    marcarAlertaLido: vi.fn(async () => undefined),
    marcarAlertasLidos: (...args: [string]) => marcarAlertasLidos(...args),
  };
});

const alerta = (over: Partial<PulseAlerta> = {}): PulseAlerta => ({
  id: 'alerta-1',
  produto_id: 'produto-1',
  tipo: 'novo_concorrente',
  payload: { item_id: 'MLB1', seller_id: 1, preco: 90 },
  lido: false,
  criado_em: '2026-08-21T12:00:00.000Z',
  severidade: 'info',
  pulse_produtos: { titulo: 'Aptamil Premium 1', codigo_pai: 'APTAMIL-1', catalog_product_id: 'MLB10512495' },
  ...over,
});

function renderPainel(alertas: PulseAlerta[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(QK.pulseAlertas('todos', 0), alertas);
  render(
    <QueryClientProvider client={client}>
      <PainelAlertas onVerProduto={vi.fn()} onReprecificar={vi.fn()} />
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('PainelAlertas — limpar todos', () => {
  it('mostra o botão Limpar todos e some com a lista inteira ao clicar (não só 1 por 1)', async () => {
    const user = userEvent.setup();
    const client = renderPainel([alerta({ id: 'a1' }), alerta({ id: 'a2', tipo: 'concorrente_saiu' })]);

    expect(screen.getByText('2 alertas novos')).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: 'Limpar todos' });

    await user.click(botao);

    expect(marcarAlertasLidos).toHaveBeenCalledTimes(1);
    // Otimista: lista esvazia (e o card some, já que ele retorna null com lista vazia) antes
    // mesmo da mutation resolver de verdade.
    await waitFor(() => expect(screen.queryByText(/alertas? novos?/)).not.toBeInTheDocument());
    expect(client.getQueryData(QK.pulseAlertas('todos', 0))).toEqual([]);
  });

  it('erro em Limpar todos restaura a lista anterior e avisa', async () => {
    marcarAlertasLidos.mockRejectedValueOnce(new Error('falhou'));
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([alerta({ id: 'a1' })]);
    const user = userEvent.setup();
    renderPainel([alerta({ id: 'a1' })]);

    await user.click(screen.getByRole('button', { name: 'Limpar todos' }));

    await waitFor(() => expect(screen.getByText('1 alerta novo')).toBeInTheDocument());
  });
});
