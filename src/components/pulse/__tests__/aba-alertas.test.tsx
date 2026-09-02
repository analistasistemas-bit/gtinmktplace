import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbaAlertas } from '../aba-alertas';
import {
  ALERTAS_POR_PAGINA, contarPulseAlertas, fetchPulseAlertas, marcarAlertasLidos,
  marcarAlertasLidosPorIds, type PulseAlerta,
} from '@/lib/pulse';

vi.mock('@/lib/pulse', async () => {
  const real = await vi.importActual<typeof import('@/lib/pulse')>('@/lib/pulse');
  return {
    ...real,
    fetchPulseAlertas: vi.fn(async () => []),
    contarPulseAlertas: vi.fn(async () => 0),
    marcarAlertasLidosPorIds: vi.fn(async () => undefined),
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
  Array.from({ length: ALERTAS_POR_PAGINA }, (_, i) =>
    alerta({ id: `${prefixo}-${i}`, produto_id: `produto-${prefixo}-${i}` }));

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
  vi.mocked(marcarAlertasLidosPorIds).mockResolvedValue(undefined);
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
    vi.mocked(fetchPulseAlertas).mockResolvedValue([
      alerta({ id: 'a1', produto_id: 'p1' }), alerta({ id: 'a2', produto_id: 'p2' }),
    ]);
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
    vi.mocked(marcarAlertasLidosPorIds).mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchPulseAlertas).mockResolvedValue([
      alerta({ id: 'a1', produto_id: 'p1' }), alerta({ id: 'a2', produto_id: 'p2' }),
    ]);
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
      alerta({ id: 'a1', produto_id: 'p1', severidade: 'acao' }),
      alerta({ id: 'a2', produto_id: 'p2', severidade: 'info' }),
    ]);
    renderAba();
    await user.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() => expect(screen.getByText('Ação', { selector: 'span' })).toBeInTheDocument());
    expect(screen.getByText('Info', { selector: 'span' })).toBeInTheDocument();
  });
});

// ADR-0133 Errata 4: a fila do operador é de produtos, não de eventos.
describe('AbaAlertas — agrupada por produto', () => {
  it('dois alertas do mesmo produto viram uma linha com "2 movimentos"', async () => {
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1', criado_em: '2026-09-01T11:00:00.000Z' }),
      alerta({ id: 'a2', produto_id: 'p1', criado_em: '2026-09-01T09:00:00.000Z' }),
    ]);
    renderAba();
    expect(await screen.findByText(/2 movimentos/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Ver produto/ })).toHaveLength(1);
  });

  it('a linha diz a idade do alerta mais recente', async () => {
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ criado_em: new Date(Date.now() - 3 * 3600_000).toISOString() }),
    ]);
    renderAba();
    expect(await screen.findByText(/há cerca de 3 horas/)).toBeInTheDocument();
  });

  // Escopo do ✓: exatamente os ids daquela linha. O `p2` está aqui para provar o "nem mais" — se o
  // clique mandasse a lista carregada, a asserção pegaria 'b1' junto.
  it('o ✓ do grupo marca TODOS os alertas daquele produto, numa chamada só', async () => {
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1' }), alerta({ id: 'a2', produto_id: 'p1' }),
      alerta({ id: 'b1', produto_id: 'p2' }),
    ]);
    renderAba();
    // `: ` no padrão de propósito: sem ele o nome casa também com o "Marcar como lidos" do topo
    // enquanto a contagem está pendente, e o clique cairia no botão errado (desabilitado).
    await userEvent.click((await screen.findAllByRole('button', { name: /^Marcar como lido: / }))[0]);
    await waitFor(() => expect(marcarAlertasLidosPorIds).toHaveBeenCalledWith(['a1', 'a2']));
  });

  it('o botão do topo continua contando ALERTAS, não grupos', async () => {
    vi.mocked(contarPulseAlertas).mockResolvedValue(9);
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1' }), alerta({ id: 'a2', produto_id: 'p1' }),
    ]);
    renderAba();
    expect(await screen.findByRole('button', { name: 'Marcar 9 como lidos' })).toBeInTheDocument();
  });

  it('expandir o grupo mostra os movimentos anteriores', async () => {
    // `tipo` explícito: o default do helper é 'novo_concorrente', que não renderiza "de X para Y".
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1', tipo: 'preco_caiu', criado_em: '2026-09-01T11:00:00.000Z', payload: { de: 70.19, para: 67.99 } }),
      alerta({ id: 'a2', produto_id: 'p1', tipo: 'preco_caiu', criado_em: '2026-09-01T09:00:00.000Z', payload: { de: 69.8, para: 67.99 } }),
    ]);
    renderAba();
    await userEvent.click(await screen.findByText(/2 movimentos/));
    expect(screen.getByText(/de R\$\s*69,80 para R\$\s*67,99/)).toBeInTheDocument();
  });

  // D-1: queda encoberta por um `novo_concorrente` posterior mantém o botão, e ele reprecifica
  // contra o par de preços mais fresco — não contra o alerta que a linha exibe.
  it('Reprecificar segue o grupo, não o alerta exibido', async () => {
    const onReprecificar = vi.fn();
    const queda = alerta({
      id: 'a2', produto_id: 'p1', tipo: 'preco_caiu',
      criado_em: '2026-09-01T09:00:00.000Z', payload: { de: 70, para: 68 },
    });
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1', tipo: 'novo_concorrente', criado_em: '2026-09-01T11:00:00.000Z' }),
      queda,
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AbaAlertas onVerProduto={vi.fn()} onReprecificar={onReprecificar} onVerRadar={vi.fn()} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Reprecificar/ }));
    expect(onReprecificar).toHaveBeenCalledWith(queda);
  });
});
