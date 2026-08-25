import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbaAlertas } from '../aba-alertas';
import { contarPulseAlertas, fetchPulseAlertas, marcarAlertasLidos, type PulseAlerta } from '@/lib/pulse';

vi.mock('@/lib/pulse', async () => {
  const real = await vi.importActual<typeof import('@/lib/pulse')>('@/lib/pulse');
  return {
    ...real,
    fetchPulseAlertas: vi.fn(async () => []),
    contarPulseAlertas: vi.fn(async () => 0),
    marcarAlertaLido: vi.fn(async () => undefined),
    marcarAlertasLidos: vi.fn(async () => undefined),
  };
});

const alerta = (over: Partial<PulseAlerta> = {}): PulseAlerta => ({
  id: 'alerta-1',
  produto_id: 'produto-1',
  tipo: 'novo_concorrente',
  payload: { item_id: 'MLB1', seller_id: 1, preco: 90 },
  lido: false,
  criado_em: '2026-08-21T12:00:00.000Z',
  severidade: 'acao',
  pulse_produtos: { titulo: 'Aptamil Premium 1', codigo_pai: 'APTAMIL-1', catalog_product_id: 'MLB10512495' },
  ...over,
});

function renderAba() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AbaAlertas onVerProduto={vi.fn()} onReprecificar={vi.fn()} onVerRadar={vi.fn()} />
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` só limpa histórico de chamadas, não a implementação presa por
  // `mockResolvedValue`/`mockRejectedValue` num teste anterior — sem isto, um teste que muda o
  // retorno vazava para os seguintes (mock "persistente" por acidente de ordem, não por garantia).
  vi.mocked(fetchPulseAlertas).mockResolvedValue([]);
  vi.mocked(contarPulseAlertas).mockResolvedValue(0);
});

describe('AbaAlertas', () => {
  it('abre no filtro Ação', async () => {
    renderAba();
    await waitFor(() => expect(fetchPulseAlertas).toHaveBeenCalledWith({ severidade: 'acao', pagina: 0 }));
  });

  it('trocar para Informativo refaz a busca com severidade info', async () => {
    const user = userEvent.setup();
    renderAba();
    await waitFor(() => expect(fetchPulseAlertas).toHaveBeenCalledWith({ severidade: 'acao', pagina: 0 }));
    await user.click(screen.getByRole('tab', { name: 'Informativo' }));
    await waitFor(() => expect(fetchPulseAlertas).toHaveBeenCalledWith({ severidade: 'info', pagina: 0 }));
  });

  it('cabeçalho mostra a contagem real, não o tamanho da página carregada', async () => {
    vi.mocked(contarPulseAlertas).mockImplementation(async (severidade) => (severidade === 'acao' ? 145 : 0));
    vi.mocked(fetchPulseAlertas).mockResolvedValue([alerta({ id: 'a1' }), alerta({ id: 'a2' })]);
    renderAba();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar 145 como lidos' })).toBeInTheDocument());
    // A lista carregada tem só 2 — se o rótulo tivesse usado lista.length em vez da contagem, diria "2".
    expect(screen.getAllByRole('button', { name: 'Ver produto' })).toHaveLength(2);
  });

  it('Marcar N como lidos chama marcarAlertasLidos com a severidade ativa', async () => {
    const user = userEvent.setup();
    vi.mocked(contarPulseAlertas).mockImplementation(async (severidade) => (severidade === 'info' ? 7 : 0));
    renderAba();
    await user.click(screen.getByRole('tab', { name: 'Informativo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar 7 como lidos' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Marcar 7 como lidos' }));
    expect(marcarAlertasLidos).toHaveBeenCalledWith('info');
  });

  it('estado vazio de Ação mostra Ver informativos e o caminho para o Radar', async () => {
    vi.mocked(contarPulseAlertas).mockImplementation(async (severidade) => (severidade === 'info' ? 12 : 0));
    renderAba();
    await waitFor(() => expect(screen.getByText('Ver informativos (12)')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Radar/ })).toBeInTheDocument();
  });

  it('fetchPulseAlertas rejeitando renderiza a faixa de erro e não o estado vazio', async () => {
    vi.mocked(fetchPulseAlertas).mockRejectedValue(new Error('falhou'));
    renderAba();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('Nenhum alerta exige decisão agora')).not.toBeInTheDocument();
  });
});
