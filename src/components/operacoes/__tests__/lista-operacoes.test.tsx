import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ListaOperacoes } from '../lista-operacoes';
import { useCriarOperacao, useItensOperacao, useOperacao, useOperacaoPorOrigem, useOperacoes, usePodeExecutarOperacao, useRetomarOperacao, type ItemOperacaoRow, type OperacaoRow } from '@/hooks/useOperacoes';
import { useItensPromocao } from '@/hooks/usePromocoes';
import { useNomesUsuarios } from '@/hooks/useNomesUsuarios';
import type { CorProjetada, ItemPromocao } from '@/lib/promocoes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useOperacoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes');
  return {
    ...actual, useOperacoes: vi.fn(), useItensOperacao: vi.fn(), usePodeExecutarOperacao: vi.fn(),
    useCriarOperacao: vi.fn(), useOperacao: vi.fn(), useOperacaoPorOrigem: vi.fn(), useRetomarOperacao: vi.fn(),
    useSimularPrecos: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

// Mesmo formato de `dataHora` em lista-operacoes.tsx — não exportado, replicado só p/ montar o texto esperado.
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
vi.mock('@/hooks/usePromocoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/usePromocoes')>('@/hooks/usePromocoes');
  return { ...actual, useItensPromocao: vi.fn() };
});
vi.mock('@/hooks/useNomesUsuarios', () => ({ useNomesUsuarios: vi.fn() }));
vi.mock('../preview-reajuste', () => ({
  PreviewReajuste: ({ pedido }: { pedido: unknown }) => <div data-testid="preview-reajuste">{JSON.stringify(pedido)}</div>,
}));

function op(over: Partial<OperacaoRow> = {}): OperacaoRow {
  return {
    id: 'OP1', org_id: 'ORG1', acao: 'aderir', promocao_id: 'P1', promocao_nome: 'Campanha X', promocao_tipo: 'DEAL',
    status: 'concluida', criado_em: '2026-09-01T10:00:00Z', criado_por: 'U1', concluido_em: '2026-09-01T10:05:00Z',
    origem_id: null, expira_em: null, sugestao: null, itens: [], ...over,
  };
}
function itemLog(over: Partial<ItemOperacaoRow> = {}): ItemOperacaoRow {
  return {
    ml_item_id: 'MLB1', operacao_id: 'OP1', org_id: 'ORG1', promocao_id: 'P1', status: 'aplicado',
    titulo: 'Produto 1', preco: 20, semaforo: 'verde', mensagem: null, offer_id: null, confirmado_risco: false,
    conferencias: 0, proxima_conferencia: null, saida_pedida_em: null, atualizado_em: '2026-09-01T10:05:00Z',
    preco_anterior: null, etapa: null, confirmado_sem_dado: false, incluido: true, avaliacao: null,
    estado_anterior: null, variacoes_ml: null, variacao_ids: null, codigo_pai: null,
    ...over,
  };
}
function cor(over: Partial<CorProjetada> = {}): CorProjetada {
  return {
    variation_id: 1, cor: 'Azul', sku: null, custo: 5, piso: 10, origem: 'nacional',
    comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0,
    liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null,
    ...over,
  };
}
// preco_sugerido:85 com cor() (custo 5, piso 10, comissão 12%) dá líquido 74,8 -> verde (mesmos
// números do "DEAL aderir marca só o verde por padrão" em preview-operacao.test.tsx).
function itemCentral(over: Partial<ItemPromocao> = {}): ItemPromocao {
  return {
    ml_item_id: 'MLB1', status: 'candidate',
    preco_original: 100, preco_promo: 80, preco_min: 70, preco_max: 90,
    preco_sugerido: 85, preco_avaliado: 10, ml_pct: null, estoque_min: null,
    titulo: 'Produto 1', thumbnail: null, permalink: null,
    projecao: [cor()], pior_semaforo: 'verde',
    ...over,
  };
}

const mutateAsync = vi.fn();
const retomarMut = vi.fn();

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ operacao_id: 'op-nova' });
  vi.mocked(useCriarOperacao).mockReturnValue({ mutateAsync, isPending: false } as never);
  retomarMut.mockReset().mockResolvedValue(undefined);
  vi.mocked(useRetomarOperacao).mockReturnValue({ mutateAsync: retomarMut, isPending: false } as never);
  vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
  vi.mocked(useNomesUsuarios).mockReturnValue({ data: new Map([['U1', 'Diego']]) } as never);
  vi.mocked(useItensPromocao).mockReturnValue({ data: [itemCentral()] } as never);
  vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog()] } as never);
  vi.mocked(useOperacao).mockReturnValue({ data: undefined } as never);
  vi.mocked(useOperacaoPorOrigem).mockReturnValue({ data: null, isLoading: false } as never);
});

function renderLista(filtro?: 'promocao' | 'publicados') {
  return render(<MemoryRouter><ListaOperacoes filtro={filtro} /></MemoryRouter>);
}

describe('ListaOperacoes', () => {
  it('carregando mostra a logo PubliAI pulsando, não blocos cinza', async () => {
    vi.mocked(useOperacoes).mockReturnValue({ data: undefined, isLoading: true } as never);
    renderLista('promocao');
    expect(await screen.findByRole('status', { name: 'Carregando' })).toHaveTextContent('Lendo as operações…');
  });

  it('lista vazia na aba de Publicados aponta para a aba Anúncios', () => {
    vi.mocked(useOperacoes).mockReturnValue({ data: [], isLoading: false } as never);
    renderLista('publicados');
    expect(screen.getByText('Nenhuma operação ainda.')).toBeInTheDocument();
    expect(screen.getByText('Selecione anúncios na aba Anúncios para pausar, reativar ou reajustar o preço.')).toBeInTheDocument();
  });

  it('lista vazia com filtro de promoção mantém a dica de campanha', () => {
    vi.mocked(useOperacoes).mockReturnValue({ data: [], isLoading: false } as never);
    renderLista('promocao');
    expect(screen.getByText('Selecione anúncios numa campanha para aderir ou sair.')).toBeInTheDocument();
  });

  it('operação de pausar mostra "Pausar 3 anúncios"', () => {
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ acao: 'pausar', promocao_id: null, promocao_nome: null, promocao_tipo: null,
        itens: [{ status: 'aplicado' }, { status: 'aplicado' }, { status: 'erro' }] })], isLoading: false,
    } as never);
    renderLista();
    expect(screen.getByText('Pausar 3 anúncios')).toBeInTheDocument();
  });

  it('filtro="promocao" é repassado ao hook (filtro no servidor); sem filtro, não', () => {
    vi.mocked(useOperacoes).mockReturnValue({ data: [], isLoading: false } as never);
    renderLista('promocao');
    expect(useOperacoes).toHaveBeenLastCalledWith('promocao');
    renderLista();
    expect(useOperacoes).toHaveBeenLastCalledWith(undefined);
  });

  // Pedido do Diego (03/11): o mesmo sinal de espera do cadastro (aura) + raio na borda enquanto roda.
  it('operação executando: aria-busy, aura e raio na borda; concluída: nenhum', () => {
    vi.mocked(useOperacoes).mockReturnValue({
      data: [
        op({ id: 'RODA', status: 'executando', itens: [{ status: 'pendente' }, { status: 'aplicado' }] }),
        op({ id: 'FIM', acao: 'sair', status: 'concluida', itens: [{ status: 'aplicado' }] }),
      ], isLoading: false,
    } as never);
    const { container } = renderLista();
    const [rodando, concluida] = [...container.querySelectorAll('li')];
    expect(rodando).toHaveAttribute('aria-busy', 'true');
    expect(rodando.querySelector('.glow-effect-sombra')).not.toBeNull();
    expect(rodando.querySelector('.border-trail__glow')).not.toBeNull();
    expect(concluida).toHaveAttribute('aria-busy', 'false');
    expect(concluida.querySelector('.glow-effect-sombra')).toBeNull();
    expect(concluida.querySelector('.border-trail__glow')).toBeNull();
  });

  it('mostra as contagens por status em chips', () => {
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ itens: [{ status: 'aplicado' }, { status: 'aplicado' }, { status: 'erro' }] })], isLoading: false,
    } as never);
    renderLista();
    expect(screen.getByText('Feito 2')).toBeInTheDocument();
    expect(screen.getByText('Erro 1')).toBeInTheDocument();
  });

  it('Reverter não aparece para quem não pode executar', async () => {
    const user = userEvent.setup();
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
    vi.mocked(useOperacoes).mockReturnValue({ data: [op({ itens: [{ status: 'aplicado' }] })], isLoading: false } as never);
    renderLista();
    await user.click(screen.getByText('Aderir à Campanha X'));
    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
  });

  it('Reverter não aparece sem itens revertíveis (operação sair só reverte "aplicado")', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ acao: 'sair', itens: [{ status: 'erro' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ status: 'erro' })] } as never);
    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));
    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
  });

  it('operação de pausar concluída: Reverter abre o preview de status (Reativar) com origem na operação', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ acao: 'pausar', promocao_id: null, promocao_nome: null, promocao_tipo: null, itens: [{ status: 'aplicado' }, { status: 'erro' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ status: 'aplicado' }), itemLog({ ml_item_id: 'MLB2', status: 'erro' })] } as never);
    renderLista();
    await user.click(screen.getByRole('button', { name: /Diego/ }));
    await user.click(await screen.findByRole('button', { name: 'Reverter' }));
    await user.click(await screen.findByRole('button', { name: 'Reativar 1 anúncio' }));
    expect(mutateAsync).toHaveBeenCalledWith({ acao: 'reativar', origem_id: 'OP1', itens: [{ ml_item_id: 'MLB1', titulo: 'Produto 1' }] });
    expect(toast.success).toHaveBeenCalledWith('Operação iniciada');
    // operação de status não consulta a Central (id vazio)
    expect(useItensPromocao).toHaveBeenLastCalledWith('');
  });

  it('Reverter não aparece enquanto a operação está executando', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ status: 'executando', itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    renderLista();
    await user.click(screen.getByText('Aderir à Campanha X'));
    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
  });

  it('Reverter abre o preview com a ação inversa e origemId, e marca não revertível quem mudou de estado', async () => {
    const user = userEvent.setup();
    // Operação original: "sair" concluída com MLB1 (aplicado) e MLB2 (aplicado).
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }, { status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' }), itemLog({ ml_item_id: 'MLB2', status: 'aplicado' })],
    } as never);
    // Central: MLB1 voltou a ser convidado (candidate) -> reverte ok; MLB2 já foi readerido por outro caminho (started) -> não revertível.
    vi.mocked(useItensPromocao).mockReturnValue({
      data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate' }), itemCentral({ ml_item_id: 'MLB2', status: 'started' })],
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));
    await user.click(screen.getByRole('button', { name: 'Reverter' }));

    // Ação inversa de "sair" é "aderir": preview novo mostra o título de aderir.
    expect(screen.getByText('Aderir à Campanha X')).toBeInTheDocument();
    expect(screen.getByLabelText('Selecionar MLB1')).toBeChecked();
    expect(screen.getByLabelText('Selecionar MLB2')).not.toBeChecked();
    expect(screen.getByLabelText('Selecionar MLB2')).toBeDisabled();
    expect(screen.getByText('Não revertível: o anúncio não está mais convidado/participando')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'aderir', promocao_id: 'P1', origem_id: 'OP1',
      itens: [{ ml_item_id: 'MLB1', preco: 85, confirmado_risco: false }],
      // preco: preco_sugerido do item central (DEAL aderir usa o sugerido, não o preço no ar).
    }));
  });

  // Emenda 2026-11-03: Reverter de alterar preço = outra alteração, de volta ao preço que a origem leu no ML.
  it('Reverter de alterar preço: preview de alterar com o preço anterior; sem preço anterior → não revertível', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'alterar_preco', itens: [{ status: 'aplicado' }, { status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({ data: [
      itemLog({ ml_item_id: 'MLB1', status: 'aplicado', preco: 43.9, preco_anterior: 49.9 } as never),
      itemLog({ ml_item_id: 'MLB2', status: 'aplicado', preco: 43.9, preco_anterior: null } as never),
    ] } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [
      itemCentral({ ml_item_id: 'MLB1', status: 'started', preco_promo: 43.9, preco_avaliado: 43.9 }),
      itemCentral({ ml_item_id: 'MLB2', status: 'started', preco_promo: 43.9, preco_avaliado: 43.9 }),
    ] } as never);

    renderLista();
    await user.click(screen.getByText('Alterar preço em Campanha X'));
    await user.click(screen.getByRole('button', { name: 'Reverter' }));

    expect(screen.getByText('Reverter preço em Campanha X')).toBeInTheDocument();
    expect(screen.getByLabelText('Preço de MLB1')).toHaveValue('49,90');
    expect(screen.getByLabelText('Selecionar MLB2')).toBeDisabled();
    expect(screen.getByText('Sem preço anterior registrado para reverter')).toBeInTheDocument();
  });

  it('Reverter de sair LIGHTNING abre aderir com tipo LIGHTNING, preço sugerido editável e bloqueio < R$ 19', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', promocao_tipo: 'LIGHTNING', itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })] } as never);
    vi.mocked(useItensPromocao).mockReturnValue({
      data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate', preco_min: 10, preco_max: 90 })],
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));
    await user.click(screen.getByRole('button', { name: 'Reverter' }));

    expect(screen.getByText('Aderir à Campanha X')).toBeInTheDocument();
    const input = screen.getByLabelText('Preço de MLB1');
    expect(input).toHaveValue('85,00');
    await user.clear(input);
    await user.type(input, '18,99');
    expect(screen.getByText('Mínimo R$ 19,00 (frete grátis)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();

    await user.clear(input);
    await user.type(input, '40,25');
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'aderir', itens: [{ ml_item_id: 'MLB1', preco: 40.25, confirmado_risco: false }],
    }));
  });

  it('mantém a seleção do preview do Reverter entre re-renders sem mudança real de dados (fix round 1, achado 1)', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })] } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate' })] } as never);

    const { rerender } = renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));
    await user.click(screen.getByRole('button', { name: 'Reverter' }));

    // Edição do usuário no preview: desmarca a única linha (nasce marcada — verde).
    await user.click(screen.getByLabelText('Selecionar MLB1'));
    expect(screen.getByLabelText('Selecionar MLB1')).not.toBeChecked();

    // Re-render "de fora" sem nenhuma mudança real de dados (ex.: o poll de 5s da lista enquanto
    // outra operação está executando). Sem `useMemo` em `reversao`, `montarReversao` roda de novo
    // a cada render e o `useEffect` do preview (que depende de `itens`/`naoRevertiveis` por
    // referência) reseta a seleção pro estado inicial.
    rerender(<MemoryRouter><ListaOperacoes /></MemoryRouter>);

    expect(screen.getByLabelText('Selecionar MLB1')).not.toBeChecked();
  });

  it('achado C (revisão UX): Reverter fecha o detalhe e abre só o preview — nunca os dois montados juntos', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })],
    } as never);
    vi.mocked(useItensPromocao).mockReturnValue({
      data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate' })],
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));
    // Título do Sheet (heading) — distinto do texto homônimo no card da lista atrás.
    expect(screen.getByRole('heading', { name: 'Sair de Campanha X' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Aderir à Campanha X' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reverter' }));

    // Um clique é suficiente e determinístico: o detalhe (título "Sair") fecha e só o preview
    // (título "Aderir", ação inversa) fica montado — os dois nunca coexistem.
    expect(screen.queryByRole('heading', { name: 'Sair de Campanha X' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Aderir à Campanha X' })).toBeInTheDocument();
  });

  it('achado A (revisão UX): sucesso do Reverter fecha o preview e o detalhe', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })],
    } as never);
    vi.mocked(useItensPromocao).mockReturnValue({
      data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate' })],
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));
    await user.click(screen.getByRole('button', { name: 'Reverter' }));
    expect(screen.getByRole('button', { name: 'Executar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Executar' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    // Nem o preview (título "Aderir") nem o detalhe (título "Sair") sobram na tela — volta pra lista.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Executar' })).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Aderir à Campanha X' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sair de Campanha X' })).not.toBeInTheDocument();
  });

  it('achado B (revisão UX): mostra "Revertida em ..." no lugar do botão quando já existe uma reversão na lista', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [
        op({ id: 'OP2', acao: 'aderir', origem_id: 'OP1', criado_em: '2026-09-05T12:00:00Z', itens: [{ status: 'aplicado' }] }),
        op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] }),
      ], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })],
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));

    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
    expect(screen.getByText(`Revertida em ${dataHora('2026-09-05T12:00:00Z')}`)).toBeInTheDocument();
  });

  it('achado B (revisão UX): busca a reversão por origem_id quando ela não está na página carregada', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })],
    } as never);
    vi.mocked(useOperacaoPorOrigem).mockReturnValue({
      data: op({ id: 'OP9', origem_id: 'OP1', criado_em: '2026-09-06T08:00:00Z', itens: [{ status: 'aplicado' }] }),
      isLoading: false,
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));

    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
    expect(screen.getByText(`Revertida em ${dataHora('2026-09-06T08:00:00Z')}`)).toBeInTheDocument();
  });

  it('achado IMPORTANTE (revisão Grok): reversão ainda executando mostra "Reversão em andamento", sem botão', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [
        op({ id: 'OP2', acao: 'aderir', origem_id: 'OP1', status: 'executando', itens: [] }),
        op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] }),
      ], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })],
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));

    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
    expect(screen.getByText('Reversão em andamento')).toBeInTheDocument();
  });

  it('achado IMPORTANTE (revisão Grok): reversão concluída sem nenhum item aplicado/já estava deixa o botão Reverter voltar', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [
        // Reversão "concluida" mas encerrada em erro (encerrarComErro) — nenhum item pegou.
        op({ id: 'OP2', acao: 'aderir', origem_id: 'OP1', status: 'concluida', itens: [{ status: 'erro' }, { status: 'mudou' }] }),
        op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] }),
      ], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })],
    } as never);
    vi.mocked(useItensPromocao).mockReturnValue({
      data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate' })],
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));

    expect(screen.queryByText(/Revertida em/)).not.toBeInTheDocument();
    expect(screen.queryByText('Reversão em andamento')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reverter' })).toBeInTheDocument();
  });

  it('achado MENOR (revisão Grok): enquanto a busca da reversão fora da página carrega, o botão Reverter não aparece', async () => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({
      data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })],
    } as never);
    vi.mocked(useOperacaoPorOrigem).mockReturnValue({ data: undefined, isLoading: true } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));

    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Revertida em/)).not.toBeInTheDocument();
    expect(screen.queryByText('Reversão em andamento')).not.toBeInTheDocument();
  });

  describe('reajuste (I5)', () => {
    const reaj = (over: Partial<OperacaoRow> = {}) => op({
      acao: 'reajustar', promocao_id: null, promocao_nome: null, promocao_tipo: null, status: 'executando', concluido_em: null,
      itens: [{ status: 'aplicado', incluido: true }, { status: 'conferindo', incluido: true },
        { status: 'bloqueado', incluido: false }, { status: 'ja_estava', incluido: false }],
      ...over,
    });

    it('título conta só os incluídos; status "Executando" só para executando', () => {
      vi.mocked(useOperacoes).mockReturnValue({ data: [reaj(), reaj({ id: 'OP2', status: 'concluida' })], isLoading: false } as never);
      renderLista();
      expect(screen.getAllByText('Reajustar preço de 2 anúncios')).toHaveLength(2);
      expect(screen.getByText('1/2')).toBeInTheDocument(); // progresso só sobre os incluídos (aplicado + conferindo)
      // chips também só sobre os incluídos: bloqueado/ja_estava com incluido=false não aparecem
      expect(screen.queryByText(/^Bloqueado/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Já estava/)).not.toBeInTheDocument();
      expect(screen.getAllByText('Executando')).toHaveLength(1);
      expect(screen.getByText('Concluída')).toBeInTheDocument();
    });

    it('Reverter com a operação ainda executando (conferindo não impede) abre o preview com origem_id', async () => {
      const user = userEvent.setup();
      vi.mocked(useOperacoes).mockReturnValue({ data: [reaj()], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [
        itemLog({ ml_item_id: 'MLB1', status: 'aplicado', preco_anterior: 10, preco: 11 }),
        itemLog({ ml_item_id: 'MLB2', status: 'conferindo', preco_anterior: 20, preco: 22 }),
      ] } as never);
      renderLista();
      await user.click(screen.getByText('Reajustar preço de 2 anúncios'));
      expect(screen.getByText(/R\$\s10,00 → R\$\s11,00/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Reverter' }));
      expect(screen.getByTestId('preview-reajuste')).toHaveTextContent('{"origem_id":"OP1"}');
    });

    it('Retomar: conferindo vencido há > 2 min → botão chama a edge e avisa', async () => {
      const user = userEvent.setup();
      const vencido = new Date(Date.now() - 5 * 60_000).toISOString();
      vi.mocked(useOperacoes).mockReturnValue({ data: [reaj()], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ status: 'conferindo', proxima_conferencia: vencido })] } as never);
      renderLista();
      await user.click(screen.getByText('Reajustar preço de 2 anúncios'));
      await user.click(screen.getByRole('button', { name: 'Retomar' }));
      expect(retomarMut).toHaveBeenCalledWith('OP1');
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Operação retomada'));
    });

    it('Retomar: agendado no futuro, operação concluída ou sem permissão → sem botão', async () => {
      const user = userEvent.setup();
      const futuro = new Date(Date.now() + 5 * 60_000).toISOString();
      const vencido = new Date(Date.now() - 5 * 60_000).toISOString();
      vi.mocked(useOperacoes).mockReturnValue({ data: [reaj()], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ status: 'conferindo', proxima_conferencia: futuro })] } as never);
      const { unmount } = renderLista();
      await user.click(screen.getByText('Reajustar preço de 2 anúncios'));
      expect(screen.queryByRole('button', { name: 'Retomar' })).not.toBeInTheDocument();
      unmount();

      vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ status: 'conferindo', proxima_conferencia: vencido })] } as never);
      vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
      renderLista();
      await user.click(screen.getByText('Reajustar preço de 2 anúncios'));
      expect(screen.queryByRole('button', { name: 'Retomar' })).not.toBeInTheDocument();
    });

    it('sem item aplicado não há Reverter', async () => {
      const user = userEvent.setup();
      vi.mocked(useOperacoes).mockReturnValue({ data: [reaj()], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ status: 'conferindo' })] } as never);
      renderLista();
      await user.click(screen.getByText('Reajustar preço de 2 anúncios'));
      expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
    });
  });

  // Pedido do Diego (03/11): ML 500 em 2 de 17 adesões — botão para tentar de novo só os itens com erro.
  it.each(['SMART_LIGHTNING', 'PRICE_MATCHING'])('Reverter de sair %s mantém o tipo e envia o preço exibido da oferta', async (tipo) => {
    const user = userEvent.setup();
    vi.mocked(useOperacoes).mockReturnValue({
      data: [op({ id: 'OP1', acao: 'sair', promocao_tipo: tipo, itens: [{ status: 'aplicado' }] })], isLoading: false,
    } as never);
    vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ ml_item_id: 'MLB1', status: 'aplicado' })] } as never);
    vi.mocked(useItensPromocao).mockReturnValue({
      data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate', preco_promo: 64, preco_sugerido: null, estoque_min: 5 })],
    } as never);
    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));
    await user.click(screen.getByRole('button', { name: 'Reverter' }));
    expect(screen.queryByLabelText('Preço de MLB1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'aderir', itens: [{ ml_item_id: 'MLB1', preco: 64, confirmado_risco: false }],
    }));
  });

  describe('Tentar novamente os com erro', () => {
    const opErro = (over: Partial<OperacaoRow> = {}) => op({ id: 'OP1', acao: 'aderir', itens: [{ status: 'erro' }, { status: 'erro' }, { status: 'aplicado' }], ...over });
    beforeEach(() => {
      vi.mocked(useOperacoes).mockReturnValue({ data: [opErro()], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [
        itemLog({ ml_item_id: 'MLB1', status: 'erro', preco: 44.9, mensagem: 'ML 500: Oops! Something went wrong...' }),
        itemLog({ ml_item_id: 'MLB2', status: 'erro', preco: 44.9 }),
        itemLog({ ml_item_id: 'MLB3', status: 'aplicado', preco: 44.9 }),
      ] } as never);
      vi.mocked(useItensPromocao).mockReturnValue({ data: [
        itemCentral({ ml_item_id: 'MLB1', status: 'candidate' }), itemCentral({ ml_item_id: 'MLB2', status: 'started' }),
        itemCentral({ ml_item_id: 'MLB3', status: 'started' }),
      ], isSuccess: true } as never);
    });

    it('abre o preview da mesma ação só com os itens com erro, no preço da operação; quem já entrou fica bloqueado', async () => {
      const user = userEvent.setup();
      renderLista();
      await user.click(screen.getByText('Aderir à Campanha X'));
      await user.click(screen.getByRole('button', { name: 'Tentar novamente 2 com erro' }));
      expect(within(screen.getByRole('dialog')).getByText('Aderir à Campanha X')).toBeInTheDocument();
      expect(screen.getByLabelText('Selecionar MLB1')).toBeChecked();
      expect(screen.getByLabelText('Selecionar MLB2')).toBeDisabled();
      expect(screen.queryByLabelText('Selecionar MLB3')).toBeNull();
      expect(screen.getByText('Não dá para tentar de novo: o anúncio não está mais convidado/participando')).toBeInTheDocument();
      // Preço da operação original (não o sugerido da Central, R$ 85).
      expect(screen.getByLabelText('Preço de MLB1')).toHaveValue('44,90');
    });

    it.each(['SMART_LIGHTNING', 'PRICE_MATCHING'])('%s: retentativa usa o preço atual da Central, não o do log', async (tipo) => {
      const user = userEvent.setup();
      vi.mocked(useOperacoes).mockReturnValue({ data: [opErro({ promocao_tipo: tipo })], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ ml_item_id: 'MLB1', status: 'erro', preco: 44.9 })] } as never);
      vi.mocked(useItensPromocao).mockReturnValue({
        data: [itemCentral({ ml_item_id: 'MLB1', status: 'candidate', preco_promo: 64, preco_sugerido: null })], isSuccess: true,
      } as never);
      renderLista();
      await user.click(screen.getByText('Aderir à Campanha X'));
      await user.click(screen.getByRole('button', { name: 'Tentar novamente 1 com erro' }));
      expect(screen.getByLabelText('Selecionar MLB1')).toBeChecked();
      await user.click(screen.getByRole('button', { name: 'Executar' }));
      expect(mutateAsync.mock.calls.at(-1)![0].itens).toEqual([{ ml_item_id: 'MLB1', preco: 64, confirmado_risco: false }]);
    });

    it('SMART: tenta de novo sem preço (o preço é do ML)', async () => {
      const user = userEvent.setup();
      vi.mocked(useOperacoes).mockReturnValue({ data: [opErro({ promocao_tipo: 'SMART' })], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ ml_item_id: 'MLB1', status: 'erro', preco: null })] } as never);
      renderLista();
      await user.click(screen.getByText('Aderir à Campanha X'));
      await user.click(screen.getByRole('button', { name: 'Tentar novamente 1 com erro' }));
      await user.click(screen.getByRole('button', { name: 'Executar' }));
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ acao: 'aderir', promocao_id: 'P1', origem_id: null }));
      expect(mutateAsync.mock.calls.at(-1)![0].itens.map((i: { ml_item_id: string }) => i.ml_item_id)).toEqual(['MLB1']);
    });

    it('sem botão: Reverter (tem origem), executando, sem permissão, sem erros; Central carregando → desabilitado', async () => {
      const user = userEvent.setup();
      const casos: [Partial<OperacaoRow>, ItemOperacaoRow[] | null][] = [
        [{ origem_id: 'OP0' }, null], [{ status: 'executando' }, null],
        [{ itens: [{ status: 'aplicado' }] }, [itemLog({ ml_item_id: 'MLB3', status: 'aplicado' })]],
      ];
      for (const [over, log] of casos) {
        vi.mocked(useOperacoes).mockReturnValue({ data: [opErro(over)], isLoading: false } as never);
        if (log) vi.mocked(useItensOperacao).mockReturnValue({ data: log } as never);
        const { unmount } = renderLista();
        await user.click(screen.getAllByText(/Campanha X/)[0]);
        expect(screen.queryByRole('button', { name: /Tentar novamente/ })).toBeNull();
        unmount();
      }
      vi.mocked(useOperacoes).mockReturnValue({ data: [opErro()], isLoading: false } as never);
      vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog({ ml_item_id: 'MLB1', status: 'erro' }), itemLog({ ml_item_id: 'MLB2', status: 'erro' })] } as never);
      vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
      const { unmount } = renderLista();
      await user.click(screen.getByText('Aderir à Campanha X'));
      expect(screen.queryByRole('button', { name: /Tentar novamente/ })).toBeNull();
      unmount();
      vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
      vi.mocked(useItensPromocao).mockReturnValue({ data: undefined, isSuccess: false } as never);
      renderLista();
      await user.click(screen.getByText('Aderir à Campanha X'));
      expect(screen.getByRole('button', { name: 'Tentar novamente 2 com erro' })).toBeDisabled();
    });
  });
});
