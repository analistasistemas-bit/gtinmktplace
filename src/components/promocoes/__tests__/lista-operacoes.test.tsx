import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ListaOperacoes } from '../lista-operacoes';
import { useCriarOperacao, useItensOperacao, useOperacao, useOperacaoPorOrigem, useOperacoes, usePodeExecutarOperacao, type ItemOperacaoRow, type OperacaoRow } from '@/hooks/useOperacoes';
import { useItensPromocao } from '@/hooks/usePromocoes';
import { useNomesUsuarios } from '@/hooks/useNomesUsuarios';
import type { CorProjetada, ItemPromocao } from '@/lib/promocoes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useOperacoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes');
  return {
    ...actual, useOperacoes: vi.fn(), useItensOperacao: vi.fn(), usePodeExecutarOperacao: vi.fn(),
    useCriarOperacao: vi.fn(), useOperacao: vi.fn(), useOperacaoPorOrigem: vi.fn(),
  };
});

// Mesmo formato de `dataHora` em lista-operacoes.tsx — não exportado, replicado só p/ montar o texto esperado.
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
vi.mock('@/hooks/usePromocoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/usePromocoes')>('@/hooks/usePromocoes');
  return { ...actual, useItensPromocao: vi.fn() };
});
vi.mock('@/hooks/useNomesUsuarios', () => ({ useNomesUsuarios: vi.fn() }));

function op(over: Partial<OperacaoRow> = {}): OperacaoRow {
  return {
    id: 'OP1', org_id: 'ORG1', acao: 'aderir', promocao_id: 'P1', promocao_nome: 'Campanha X', promocao_tipo: 'DEAL',
    status: 'concluida', criado_em: '2026-09-01T10:00:00Z', criado_por: 'U1', concluido_em: '2026-09-01T10:05:00Z',
    origem_id: null, itens: [], ...over,
  };
}
function itemLog(over: Partial<ItemOperacaoRow> = {}): ItemOperacaoRow {
  return {
    ml_item_id: 'MLB1', operacao_id: 'OP1', org_id: 'ORG1', promocao_id: 'P1', status: 'aplicado',
    titulo: 'Produto 1', preco: 20, semaforo: 'verde', mensagem: null, offer_id: null, confirmado_risco: false,
    conferencias: 0, proxima_conferencia: null, saida_pedida_em: null, atualizado_em: '2026-09-01T10:05:00Z',
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

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ operacao_id: 'op-nova' });
  vi.mocked(useCriarOperacao).mockReturnValue({ mutateAsync, isPending: false } as never);
  vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
  vi.mocked(useNomesUsuarios).mockReturnValue({ data: new Map([['U1', 'Diego']]) } as never);
  vi.mocked(useItensPromocao).mockReturnValue({ data: [itemCentral()] } as never);
  vi.mocked(useItensOperacao).mockReturnValue({ data: [itemLog()] } as never);
  vi.mocked(useOperacao).mockReturnValue({ data: undefined } as never);
  vi.mocked(useOperacaoPorOrigem).mockReturnValue({ data: null } as never);
});

function renderLista() {
  return render(<MemoryRouter><ListaOperacoes /></MemoryRouter>);
}

describe('ListaOperacoes', () => {
  it('lista vazia', () => {
    vi.mocked(useOperacoes).mockReturnValue({ data: [], isLoading: false } as never);
    renderLista();
    expect(screen.getByText('Nenhuma operação ainda.')).toBeInTheDocument();
    expect(screen.getByText('Selecione anúncios numa campanha para aderir ou sair.')).toBeInTheDocument();
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
        op({ id: 'OP2', acao: 'aderir', origem_id: 'OP1', criado_em: '2026-09-05T12:00:00Z', itens: [] }),
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
      data: op({ id: 'OP9', origem_id: 'OP1', criado_em: '2026-09-06T08:00:00Z' }),
    } as never);

    renderLista();
    await user.click(screen.getByText('Sair de Campanha X'));

    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
    expect(screen.getByText(`Revertida em ${dataHora('2026-09-06T08:00:00Z')}`)).toBeInTheDocument();
  });
});
