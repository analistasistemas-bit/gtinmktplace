import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbaAlertas } from '../aba-alertas';
import {
  ALERTAS_POR_PAGINA, contarPulseAlertas, fetchPulseAlertas, marcarAlertaLido, marcarAlertasLidos,
  type PulseAlerta,
} from '@/lib/pulse';

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

/** Página cheia — é o que faz `getNextPageParam` liberar o "Carregar mais". */
const paginaCheia = (prefixo: string) =>
  Array.from({ length: ALERTAS_POR_PAGINA }, (_, i) => alerta({ id: `${prefixo}-${i}` }));

const verProduto = () => screen.getAllByRole('button', { name: /^Ver produto: / });

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
  vi.mocked(marcarAlertaLido).mockResolvedValue(undefined);
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
    await user.click(screen.getByRole('button', { name: 'Informativo' }));
    await waitFor(() => expect(fetchPulseAlertas).toHaveBeenCalledWith({ severidade: 'info', pagina: 0 }));
  });

  it('cabeçalho mostra a contagem real, não o tamanho da página carregada', async () => {
    vi.mocked(contarPulseAlertas).mockImplementation(async (severidade) => (severidade === 'acao' ? 145 : 0));
    vi.mocked(fetchPulseAlertas).mockResolvedValue([alerta({ id: 'a1' }), alerta({ id: 'a2' })]);
    renderAba();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar 145 como lidos' })).toBeInTheDocument());
    // A lista carregada tem só 2 — se o rótulo tivesse usado lista.length em vez da contagem, diria "2".
    expect(verProduto()).toHaveLength(2);
  });

  // Além da severidade ativa, prova a ÂNCORA: o teto é o `criado_em` do alerta mais novo já
  // renderizado. O invariante é "nada mais novo do que o operador viu" — proteção contra a corrida
  // com o coletor em cron, NÃO contra a paginação: o que for mais antigo é marcado mesmo sem ter
  // sido rolado, e é isso que o número do rótulo promete.
  it('Marcar N como lidos usa a severidade ativa e o alerta mais novo visto como teto', async () => {
    const user = userEvent.setup();
    vi.mocked(contarPulseAlertas).mockImplementation(async (severidade) => (severidade === 'info' ? 7 : 0));
    vi.mocked(fetchPulseAlertas).mockResolvedValue([
      alerta({ id: 'a-novo', severidade: 'info', criado_em: '2026-08-25T09:00:00.000Z' }),
      alerta({ id: 'a-velho', severidade: 'info', criado_em: '2026-08-20T09:00:00.000Z' }),
    ]);
    renderAba();
    await user.click(screen.getByRole('button', { name: 'Informativo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar 7 como lidos' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Marcar 7 como lidos' }));
    expect(marcarAlertasLidos).toHaveBeenCalledWith('info', '2026-08-25T09:00:00.000Z');
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

  // I1: erro COM dado presente. O `status` do react-query v5 vai a 'error' mesmo com páginas já em
  // cache — devolver a faixa em tela cheia apagaria a lista e o próprio seletor de severidade.
  it('erro no Carregar mais mantém lista e filtro, e oferece tentar de novo', async () => {
    const user = userEvent.setup();
    vi.mocked(contarPulseAlertas).mockResolvedValue(60);
    vi.mocked(fetchPulseAlertas)
      .mockResolvedValueOnce(paginaCheia('p1'))
      .mockRejectedValue(new Error('token expirou'));
    renderAba();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(verProduto()).toHaveLength(ALERTAS_POR_PAGINA);
    expect(screen.getByRole('group', { name: 'Filtrar alertas por severidade' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  // I3: contagem sem resposta não vira "0". "Marcar 0 como lidos" com a lista cheia atrás é uma
  // promessa que a tela não pode cumprir.
  it('contagem pendente não inventa zero no rótulo do marcar em lote', async () => {
    vi.mocked(contarPulseAlertas).mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchPulseAlertas).mockResolvedValue([alerta({ id: 'a1' })]);
    renderAba();
    await waitFor(() => expect(verProduto()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Marcar 0 como lidos/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como lidos' })).toBeDisabled();
  });

  it('contagem em erro não mostra "(0)" no estado vazio de Ação', async () => {
    vi.mocked(contarPulseAlertas).mockRejectedValue(new Error('contagem falhou'));
    renderAba();
    await waitFor(() => expect(screen.getByText('Ver informativos')).toBeInTheDocument());
    expect(screen.queryByText('Ver informativos (0)')).not.toBeInTheDocument();
  });

  // M6: a janela de OFFSET desloca quando o coletor insere entre o refetch de duas páginas — a
  // mesma linha volta nas duas. Com `key={alerta.id}` isso é chave duplicada no React.
  it('id repetido entre páginas não duplica a linha', async () => {
    const user = userEvent.setup();
    vi.mocked(contarPulseAlertas).mockResolvedValue(60);
    const p1 = paginaCheia('p1');
    vi.mocked(fetchPulseAlertas)
      .mockResolvedValueOnce(p1)
      .mockResolvedValueOnce([p1[0], alerta({ id: 'so-na-pagina-2' })]);
    renderAba();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(verProduto()).toHaveLength(ALERTAS_POR_PAGINA + 1));
  });

  // I6: a linha sai na hora, não depois de refetchar as páginas carregadas + as duas contagens.
  it('marcar lido remove a linha antes da resposta do banco', async () => {
    const user = userEvent.setup();
    vi.mocked(marcarAlertaLido).mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchPulseAlertas).mockResolvedValue([alerta({ id: 'a1' }), alerta({ id: 'a2' })]);
    renderAba();
    await waitFor(() => expect(verProduto()).toHaveLength(2));
    await user.click(screen.getAllByRole('button', { name: /^Marcar como lido: / })[0]);
    await waitFor(() => expect(verProduto()).toHaveLength(1));
  });

  // M4: "Todos" é o único filtro que mistura as severidades — sem selo textual a linha não diz
  // qual das duas ela é (cor sozinha não conta).
  it('filtro Todos mostra a severidade de cada linha em texto', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPulseAlertas).mockResolvedValue([
      alerta({ id: 'a1', severidade: 'acao' }),
      alerta({ id: 'a2', severidade: 'info' }),
    ]);
    renderAba();
    await user.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() => expect(screen.getByText('Ação', { selector: 'span' })).toBeInTheDocument());
    expect(screen.getByText('Info', { selector: 'span' })).toBeInTheDocument();
  });
});
