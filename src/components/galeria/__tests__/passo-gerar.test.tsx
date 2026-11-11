import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { escolherNoSelect } from '@/test/select';
import userEvent from '@testing-library/user-event';
import { PassoGerar } from '../passo-gerar';
import { CartaoImagem } from '../cartao-imagem';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GaleriaIA from '@/pages/GaleriaIA';
import { imagemValida } from '@/lib/galeria/exibicao';
import type { Ficha, ImagemGaleria, RespostaListar, RespostaRoteiro, Res, RoteiroAprovado } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({
  montarFicha: vi.fn(), lerRoteiro: vi.fn(), listarImagens: vi.fn(), gerarImagens: vi.fn(),
  confirmarExibicao: vi.fn(), reportarInvalida: vi.fn(), prepararUploadFinal: vi.fn(), enviarFinal: vi.fn(), aprovarFinal: vi.fn(),
}));
const compor = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/galeria/compor', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/compor')>()), comporImagemFinal: compor.fn }));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));
vi.mock('@/lib/storage', () => ({ signedUrl: vi.fn(async () => 'https://x.test/e.jpg') }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Página da galeria (antes DialogGaleria): guarda própria lê módulo, admin e a linha de Publicados.
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ['imagem_ia'] }) }));
vi.mock('@/hooks/useOperacoes', () => ({ usePodeExecutarOperacao: () => true }));
vi.mock('@/hooks/usePublicados', () => ({ usePublicados: () => ({ data: [] }) }));
const valida = vi.hoisted(() => ({ fn: vi.fn() }));
/** null = a trava real (MISSOES_LUPA_PENDENTE); {geral:[],moda:[]} = ramo liberado depois do portão (Task 16). */
const trava = vi.hoisted(() => ({ travas: null as null | { geral: number[]; moda: number[] } }));
vi.mock('../../../../supabase/functions/_shared/galeria/regras', async (orig) => {
  const r = await orig<typeof import('../../../../supabase/functions/_shared/galeria/regras')>();
  return { ...r, lupaPendente: (m: number, moda: boolean) => r.lupaPendente(m, moda, trava.travas ?? r.MISSOES_LUPA_PENDENTE) };
});
vi.mock('@/lib/galeria/exibicao', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/exibicao')>()), imagemValida: valida.fn }));

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (status: number, erro: string, corpo: Record<string, unknown> = {}): Res<never> => ({ ok: false, status, erro, corpo: { error: erro, ...corpo } });

const ficha = (cores: string[]): Ficha => ({
  anuncio_externo_id: 'A1', familia_id: 'F1', codigo_pai: '0001', cores, fatos: [], fatos_hash: 'h', roteiro_desatualizado: false, referencias: {},
});
const missao = (n: number, ativa = true) => ({ missao: n, ativa, cena: `cena ${n}`, fatosUsados: [] });
const aprovado = (ativas = [1, 2, 3, 4, 5, 6, 7], extra: Partial<RoteiroAprovado> = {}): RoteiroAprovado =>
  ({ id: 'R1', versao: 3, familia_id: 'F1', moda: false, missoes_ativas: ativas, textos: { 1: {}, 2: { headline: 'Prende firme' } }, ...extra });
/** Resposta do `ler` (aba Roteiro). */
const respRoteiro = (status = 'aprovado', versao = 3): RespostaRoteiro => ({
  roteiro: { id: `R${versao}`, familia_id: 'F1', versao, status, moda: false,
    conteudo: { categoria: 'c', contrato: 'k', missoes: [1, 2, 3, 4, 5, 6, 7].map((n) => missao(n)) } },
  erros: [], erros_por_missao: {}, ciencia_pendente: [], fatos: [],
});
const imagem = (extra: Partial<ImagemGaleria> = {}): ImagemGaleria => ({
  id: 'i1', cor: 'Preto', missao: 1, geracao: 1, origem: 'gerador', status: 'gerada', alertas: [], erro: null,
  exibida: false, url: 'https://signed/i1.png', ref_url: 'https://signed/ref.jpg', roteiro_id: 'R1', pode_gerar_de_novo: true, unit_cents: 50, ...extra,
});
const lista = (imagens: ImagemGaleria[] = [], unit = 50, roteiro: RoteiroAprovado | null = aprovado()): RespostaListar =>
  ({ roteiro, unit_cents: unit, imagens });

/** `rot` informado → `listar` devolve só esse roteiro, sem imagens. */
function passo(cores = ['Preto'], rot?: RoteiroAprovado | null, mlItemId = 'MLB1') {
  if (rot !== undefined) api.listarImagens.mockResolvedValue(ok(lista([], 50, rot)));
  const props = { aoRecarregar: vi.fn(), aoVoltarRoteiro: vi.fn() };
  render(<PassoGerar mlItemId={mlItemId} ficha={ficha(cores)} {...props} />);
  return props;
}
/** Imagens que entram no pedido da cor escolhida (as bloqueadas pela lupa aparecem com o motivo, fora do pedido). */
const noPedido = () => within(screen.getByRole('list', { name: 'Imagens deste pedido' })).getAllByRole('listitem')
  .filter((li) => li.getAttribute('data-no-pedido') === 'true').map((li) => li.textContent);
/** Botão principal do protótipo: "Gerar N imagens · R$ X" (a confirmação é o próprio preço no botão). */
const botaoGerar = () => screen.getByRole('button', { name: /^Gerar \d+ imagens? ·/ });
const gerar = () => userEvent.click(botaoGerar());

beforeEach(() => {
  vi.clearAllMocks();
  trava.travas = null;
  valida.fn.mockReturnValue(true);
  api.listarImagens.mockResolvedValue(ok(lista()));
  api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
  api.reportarInvalida.mockResolvedValue(ok({ reportada: true }));
  api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
  compor.fn.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  api.prepararUploadFinal.mockResolvedValue(ok({ path: 'org/galeria-ia/F1/finais/i1-n.jpg', token: 't', signed_url: 'u' }));
  api.enviarFinal.mockResolvedValue(null);
  api.aprovarFinal.mockResolvedValue(ok({ status: 'aprovada' }));
});
afterEach(() => { vi.useRealTimers(); });

describe('PassoGerar: seleção e confirmação', () => {
  it('uma cor por pedido: entram as imagens ligadas do roteiro aprovado, menos as de lupa travada (com o motivo)', async () => {
    passo(['A', 'B', 'C'], aprovado([1, 2, 3, 5, 7]));
    await screen.findByText(/por imagem/);
    expect(screen.getByRole('combobox', { name: 'Cor' })).toHaveTextContent('A');
    expect(noPedido()).toEqual(['Capa', 'Onde usar', 'Ficha técnica']);
    expect(screen.getAllByText(/Em breve/)).toHaveLength(2);
  });

  it('com 4 ou mais cores o pedido continua sendo de uma cor só (sem multiplicar o custo)', async () => {
    passo(['A', 'B', 'C', 'D']);
    await screen.findByText(/por imagem/);
    expect(botaoGerar()).toHaveTextContent('Gerar 5 imagens · R$ 2,50');
    await gerar();
    expect(api.gerarImagens.mock.calls[0][1]).toMatchObject({ cores: ['A'], missoes: [1, 2, 4, 5, 6] });
  });

  it('ramo liberado: imagem 3 sem detalhe na cor escolhida fica fora com o motivo; em outra cor com lupa ok, entra', async () => {
    trava.travas = { geral: [], moda: [] };
    api.listarImagens.mockResolvedValue(ok(lista([], 50, aprovado())));
    const f = { ...ficha(['Rosa', 'Preto']), lupa: {
      Preto: { geral: { 3: 'ok', 7: 'ok' }, moda: { 5: 'ok', 7: 'ok' } },
      Rosa: { geral: { 3: 'indisponivel', 7: 'ok' }, moda: { 5: 'ok', 7: 'ok' } },
    } } as Ficha;
    render(<PassoGerar mlItemId="MLB1" ficha={f} aoRecarregar={vi.fn()} aoVoltarRoteiro={vi.fn()} />);
    await screen.findByText(/por imagem/);
    expect(noPedido()).not.toContain('Detalhe com lupa');
    expect(screen.getByText(/sem detalhe do produto na foto: Rosa/)).toBeInTheDocument();
    expect(noPedido()).toContain('Detalhes (recorte grátis)');
    await escolherNoSelect(userEvent.setup(), 'Cor', 'Preto');
    expect(noPedido()).toContain('Detalhe com lupa');
  });

  it('o botão mostra "N imagens · R$ X" com o preço do servidor; recortes não entram no valor', async () => {
    passo(['Preto', 'Rosa']);
    await screen.findByText(/por imagem/);
    // 1 cor × 5 imagens com gerador (a 3 e a 7, de lupa travada, ficam fora) = 5 × R$ 0,50 = R$ 2,50.
    expect(botaoGerar()).toHaveTextContent('Gerar 5 imagens · R$ 2,50');
    await gerar();
    const [ml, p] = api.gerarImagens.mock.calls[0];
    expect(ml).toBe('MLB1');
    expect(p).toMatchObject({ roteiroVersao: 3, cores: ['Preto'], missoes: [1, 2, 4, 5, 6], unitCentsExibido: 50 });
    expect(p.pedidoId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preco_mudou mostra o preço novo no botão e pede novo clique, com outro pedido_id', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'preco_mudou', { unit_cents: 80 }));
    passo();
    await screen.findByText(/por imagem/);
    await gerar();
    expect(await screen.findByText(/preço mudou/i)).toBeInTheDocument();
    expect(botaoGerar()).toHaveTextContent('Gerar 5 imagens · R$ 4,00');
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
    await gerar();
    expect(api.gerarImagens).toHaveBeenCalledTimes(2);
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(b.unitCentsExibido).toBe(80);
    expect(b.pedidoId).not.toBe(a.pedidoId);
  });

  it('recusa definitiva: motivo em português e botão desabilitado, sem nova tentativa', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'teto', { bloqueadas: [{ cor: 'Preto', missao: 1, motivo: 'teto' }] }));
    passo();
    await screen.findByText(/por imagem/);
    await gerar();
    expect(await screen.findByText(/gerou esta imagem 3 vezes/i)).toBeInTheDocument();
    expect(screen.getByText(/Capa · Preto/)).toBeInTheDocument();
    expect(botaoGerar()).toBeDisabled();
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
  });

  it('ml_indisponivel: tentar de novo reusa o mesmo pedido_id', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(503, 'ml_indisponivel'));
    passo();
    await screen.findByText(/por imagem/);
    await gerar();
    expect(await screen.findByText(/Mercado Livre indisponível, tente de novo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(b.pedidoId).toBe(a.pedidoId);
    expect(b.cores).toEqual(a.cores);
  });

  // Revisão B+C (Grok, achado 5): depois de rede/ml_indisponivel, o próprio botão Gerar repete o MESMO pedido
  // (a RPC é idempotente pelo id); só trocar a cor ou a seleção abre outro.
  it.each([['rede', 0], ['ml_indisponivel', 503]])('%s: o botão Gerar reusa o mesmo pedido_id', async (erro, status) => {
    api.gerarImagens.mockResolvedValueOnce(falha(status as number, erro as string));
    passo();
    await screen.findByText(/por imagem/);
    await gerar();
    await screen.findByText(/Mercado Livre indisponível, tente de novo/);
    await gerar();
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(b.pedidoId).toBe(a.pedidoId);
  });

  it('familia_nao_vigente: botão Recarregar visível e Gerar desabilitado', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'familia_nao_vigente', { familia_id_vigente: 'F2' }));
    const props = passo();
    await screen.findByText(/por imagem/);
    await gerar();
    await userEvent.click(await screen.findByRole('button', { name: 'Recarregar' }));
    expect(props.aoRecarregar).toHaveBeenCalled();
    expect(botaoGerar()).toBeDisabled();
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
  });

  it('roteiro aprovado de família anterior: imagens visíveis, pedido novo bloqueado com aviso', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem()], 50, aprovado(undefined, { familia_id: 'F-antiga' }))));
    passo();
    expect(await screen.findByAltText('Capa · Preto')).toBeInTheDocument();
    expect(screen.getByText(/cadastro antigo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Gerar \d+ imagens? ·/ })).toBeNull();
  });

  it('ciência pendente volta aos textos', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'conteudo.ciencia_nao_conferido', { campos: ['Material'] }));
    const props = passo();
    await screen.findByText(/por imagem/);
    await gerar();
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar aos textos' }));
    expect(props.aoVoltarRoteiro).toHaveBeenCalled();
  });
});

describe('PassoGerar: exibição e cobrança', () => {
  it('listar → imagem válida confirma uma vez, mesmo com polls seguintes (URL estável)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem(), imagem({ id: 'i2', status: 'gerando', url: null })])));
    passo();
    const img = await screen.findByAltText('Capa · Preto');
    fireEvent.load(img);
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ url: 'https://signed/outra.png', exibida: true }), imagem({ id: 'i2', status: 'gerando', url: null })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    expect(screen.getByAltText('Capa · Preto')).toHaveAttribute('src', 'https://signed/i1.png');
    fireEvent.load(screen.getByAltText('Capa · Preto'));
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(1);
  });

  it('imagem branca → reportar_invalida e nenhuma confirmação', async () => {
    valida.fn.mockReturnValue(false);
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await waitFor(() => expect(api.reportarInvalida).toHaveBeenCalledWith('MLB1', 'i1'));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
  });

  it('canvas contaminado (exceção na validação) → nem confirma nem reporta', async () => {
    valida.fn.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
    expect(api.reportarInvalida).not.toHaveBeenCalled();
  });

  it('já exibida e recorte não chamam confirmação', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ exibida: true }), imagem({ id: 'r', missao: 7, origem: 'recorte' })])));
    passo();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    fireEvent.load(screen.getByAltText('Detalhes · Preto'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
  });

  it('polling para quando tudo é terminal e os alertas chegaram; para ao desmontar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ alertas: null })])));
    const { unmount } = render(<PassoGerar mlItemId="MLB1" ficha={ficha(['Preto'])} aoRecarregar={vi.fn()} aoVoltarRoteiro={vi.fn()} />);
    await screen.findByAltText('Capa · Preto');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
  });

  it('sem linha aberta e com alertas → não faz polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem(), imagem({ id: 'f', status: 'falhou', alertas: null, url: null })])));
    passo();
    await screen.findByAltText('Capa · Preto');
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(1);
  });

  it('listar com 503 continua o polling; com 4xx para', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValueOnce(falha(503, 'falha_interna')).mockResolvedValue(ok(lista([imagem()])));
    passo();
    expect(await screen.findByText(/Erro/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(await screen.findByAltText('Capa · Preto')).toBeInTheDocument();
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
  });

  it('listar com 409 não reagenda', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(falha(409, 'anuncio_ambiguo'));
    passo();
    await screen.findByText(/identificar este anúncio/);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(1);
  });

  it('recusa definitiva seguida de poll com falha mantém o Gerar desabilitado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValueOnce(ok(lista([imagem({ status: 'gerando', url: null })]))).mockResolvedValue(falha(503, 'falha_interna'));
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'teto', { bloqueadas: [{ cor: 'Preto', missao: 1, motivo: 'teto' }] }));
    passo();
    await screen.findByText(/por imagem/);
    await gerar();
    await screen.findByText(/gerou esta imagem 3 vezes/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    expect(botaoGerar()).toBeDisabled();
    expect(screen.getByText(/gerou esta imagem 3 vezes/i)).toBeInTheDocument();
  });

  it('falha de carga não é terminal: aviso, sem cobrar nem reportar; o poll seguinte tenta com URL nova e cobra', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.error(await screen.findByAltText('Capa · Preto'));
    expect(await screen.findByText(/Não foi possível exibir a imagem/)).toBeInTheDocument();
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
    expect(api.reportarInvalida).not.toHaveBeenCalled();
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ url: 'https://signed/nova.png' })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const img = await screen.findByAltText('Capa · Preto');
    expect(img).toHaveAttribute('src', 'https://signed/nova.png');
    fireEvent.load(img);
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']));
  });

  it('confirmação com rede/5xx: o poll seguinte repete até a imagem ficar exibida', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.confirmarExibicao.mockResolvedValueOnce(falha(503, 'falha_interna')).mockResolvedValue(ok({ cobradas: 1 }));
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(2));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ exibida: true })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(2);
  });

  it('preço só no botão: nem o cartão, nem o resumo repetem o valor', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ unit_cents: 50 })], 80)));
    passo();
    await screen.findByAltText('Capa · Preto');
    expect(botaoGerar()).toHaveTextContent('Gerar 5 imagens · R$ 4,00');
    expect(screen.queryByText(/ao exibir/)).toBeNull();
    expect(screen.queryByText('Resumo')).toBeNull();
    expect(screen.getAllByText(/R\$\s/)).toHaveLength(1);
  });

  it('"Gerar de novo" não aparece quando o roteiro aprovado é de família anterior', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem()], 50, aprovado([1, 2], { familia_id: 'F0' }))));
    passo();
    await screen.findByText(/cadastro antigo/);
    expect(screen.queryByRole('button', { name: /^Gerar outra/ })).toBeNull();
  });

  it('"Gerar outra" mostra as restantes e abre a confirmação de 1 imagem junto ao cartão, da cor e missão dele', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ cor: 'Rosa', missao: 2, geracao: 1 })])));
    passo(['Rosa', 'Preto']);
    const botao = await screen.findByRole('button', { name: /^Gerar outra \(2 restantes\)/ });
    await userEvent.click(botao);
    const cartao = botao.closest('[data-estado]') as HTMLElement;
    expect(within(cartao).getByText(/1 imagem · R\$\s0,50/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(api.gerarImagens.mock.calls[0][1]).toMatchObject({ cores: ['Rosa'], missoes: [2] });
  });
});

describe('PassoGerar: gerar de novo e lupa', () => {
  it('"Gerar de novo" some em missão bloqueada pela lupa (mesmo filtro da seleção)', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ cor: 'Rosa', missao: 3 })])));
    passo(['Preto', 'Rosa']);
    await screen.findByText(/por imagem/);
    expect(screen.queryByRole('button', { name: /^Gerar outra/ })).toBeNull();
  });
});

describe('PassoGerar: aprovar (Task 12)', () => {
  it('compõe com a cena, a referência e os textos do roteiro aprovado; sobe pela URL assinada e aprova', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2 })])));
    passo();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalledWith('MLB1', 'i1', undefined));
    expect(compor.fn).toHaveBeenCalledWith({
      cenaUrl: 'https://signed/i1.png', refUrl: 'https://signed/ref.jpg', missao: 2, textos: { headline: 'Prende firme' }, corProduto: null, moda: false,
      lupa: null,
    });
    expect(api.prepararUploadFinal).toHaveBeenCalledWith('MLB1', 'i1');
    expect(api.enviarFinal).toHaveBeenCalledWith('org/galeria-ia/F1/finais/i1-n.jpg', 't', expect.any(Blob));
  });

  it('missões com lupa/recorte cego (3 e 7; Moda 5 e 7): Aprovar desabilitado com "lupa em ajuste"', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([
      imagem({ id: 'a', missao: 3 }), imagem({ id: 'b', missao: 7, origem: 'recorte', url: 'https://signed/ref.jpg' }),
    ])));
    passo();
    await screen.findByAltText('Detalhe com lupa · Preto');
    const botoes = screen.getAllByRole('button', { name: 'Aprovar' });
    expect(botoes).toHaveLength(2);
    for (const b of botoes) { expect(b).toBeDisabled(); expect(b).toHaveAttribute('title', 'Em breve'); }
    expect(compor.fn).not.toHaveBeenCalled();
  });

  it('Moda: 5 e 7 bloqueadas, 3 (cena de costas) liberada', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([
      imagem({ id: 'a', missao: 3 }), imagem({ id: 'b', missao: 5, origem: 'recorte' }),
    ], 50, aprovado(undefined, { moda: true }))));
    passo();
    await screen.findAllByRole('img');
    const [m3, m5] = screen.getAllByRole('button', { name: 'Aprovar' });
    expect(m3).toBeEnabled();
    expect(m5).toBeDisabled();
  });

  it('ramo liberado: missão 7 compõe com as caixas do listar e aprova enviando o hash delas', async () => {
    trava.travas = { geral: [], moda: [] };
    const caixas = { produto: { x: 0, y: 0, w: 1, h: 1 }, detalhes: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }], ref_w: 1000, ref_h: 1000 };
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 7, origem: 'recorte', url: 'https://signed/ref.jpg', lupa: { situacao: 'ok', ...caixas, hash: 'hashR' } })])));
    passo();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalledWith('MLB1', 'i1', 'hashR'));
    expect(compor.fn).toHaveBeenCalledWith(expect.objectContaining({ missao: 7, cenaUrl: null, lupa: caixas }));
  });

  it.each([['indisponivel', /sem detalhe do produto/i], ['lendo', /preparando esta imagem/i]] as const)(
    'ramo liberado: lupa %s → Aprovar desabilitado com o motivo no cartão, nada composto', async (situacao, motivo) => {
      trava.travas = { geral: [], moda: [] };
      api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 3, lupa: { situacao } })])));
      passo();
      const botao = await screen.findByRole('button', { name: 'Aprovar' });
      expect(botao).toBeDisabled();
      expect(screen.getByText(motivo)).toBeInTheDocument();
      expect(compor.fn).not.toHaveBeenCalled();
    });

  it('imagem de outro roteiro (não o aprovado atual): sem botão Aprovar', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ roteiro_id: 'R-antigo' })])));
    passo();
    await screen.findByAltText('Capa · Preto');
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
  });

  // Revisão geral (bloqueador 1): o servidor só aprova gerador já cobrada; a tela confirma a exibição e repete o aprovar.
  it('exibicao_pendente → confirma a exibição e repete só o aprovar (sem recompor nem novo upload)', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2, exibida: true })])));
    api.aprovarFinal.mockResolvedValueOnce(falha(409, 'exibicao_pendente'));
    passo();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalledTimes(2));
    expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']);
    expect(compor.fn).toHaveBeenCalledTimes(1);
    expect(api.prepararUploadFinal).toHaveBeenCalledTimes(1);
  });
  it('exibicao_pendente de novo após confirmar → motivo no cartão, sem laço', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2, exibida: true })])));
    api.aprovarFinal.mockResolvedValue(falha(409, 'exibicao_pendente'));
    passo();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/cobrança/i)).toBeInTheDocument();
    expect(api.aprovarFinal).toHaveBeenCalledTimes(2);
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(1);
  });
  it('texto que estoura: motivo claro no cartão e nada sobe', async () => {
    compor.fn.mockRejectedValue(new Error('Etapa 1 não cabe em 2 linhas: encurte o texto no roteiro'));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2 })])));
    passo();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/Etapa 1 não cabe na imagem/)).toBeInTheDocument();
    expect(api.prepararUploadFinal).not.toHaveBeenCalled();
    expect(api.aprovarFinal).not.toHaveBeenCalled();
  });

  it('arquivo recusado pelo servidor e referência trocada: motivo no cartão', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2 })])));
    api.aprovarFinal.mockResolvedValueOnce(falha(422, 'arquivo_invalido', { erros: ['branca'] }));
    passo();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/em branco/)).toBeInTheDocument();
    api.aprovarFinal.mockResolvedValueOnce(falha(409, 'referencia_trocada'));
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/referência/i)).toBeInTheDocument();
  });

  it('sem botão Aprovar enquanto a verificação por visão não respondeu', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ alertas: null })])));
    passo();
    await screen.findByText('Verificando texto e produto…');
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
  });
});

describe('CartaoImagem', () => {
  it('mostra os alertas da verificação', () => {
    render(<CartaoImagem imagem={imagem({ alertas: [{ tipo: 'cor', nota: 'Cor diferente da referência' }] })} onGerarDeNovo={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Cor diferente da referência');
  });

  it('"Gerar de novo" some quando o servidor diz que a vaga acabou (teto ou em andamento)', () => {
    render(<CartaoImagem imagem={imagem({ pode_gerar_de_novo: false })} onGerarDeNovo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Gerar outra/ })).toBeNull();
  });
});

describe('Estados do cartão e grade da cor', () => {
  it.each([
    [{ status: 'gerando', url: null }, 'Gerando'], [{ alertas: null }, 'Verificando'], [{}, 'Pronta'],
    [{ alertas: [{ tipo: 'texto', nota: 'Rótulo mudou' }] }, 'Confira'], [{ status: 'aprovada' }, 'Aprovada'],
  ] as const)('%j → selo %s', (extra, selo) => {
    render(<CartaoImagem imagem={imagem(extra as Partial<ImagemGaleria>)} />);
    expect(screen.getByText(selo, { selector: '[data-tone]' })).toBeInTheDocument();
  });

  it('só as imagens da cor escolhida; trocar a cor troca a grade; cor sem imagem mostra o estado vazio', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ id: 'a', cor: 'Preto' }), imagem({ id: 'b', cor: 'Rosa', missao: 2 })])));
    passo(['Preto', 'Rosa', 'Azul']);
    await screen.findByAltText('Capa · Preto');
    expect(screen.queryByAltText('Onde usar · Rosa')).toBeNull();
    await escolherNoSelect(userEvent.setup(), 'Cor', 'Rosa');
    expect(screen.getByAltText('Onde usar · Rosa')).toBeInTheDocument();
    await escolherNoSelect(userEvent.setup(), 'Cor', 'Azul');
    expect(screen.getByText('Nenhuma imagem da cor Azul ainda.')).toBeInTheDocument();
  });

  it('nenhuma mensagem do operador mostra código cru nem termo interno', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'codigo_que_nao_existe', { bloqueadas: [{ cor: 'Preto', missao: 1 }] }));
    passo();
    await screen.findByRole('button', { name: /^Gerar 5/ });
    await gerar();
    expect(await screen.findByText('Não deu certo. Tente de novo; se repetir, avise o suporte.')).toBeInTheDocument();
    expect(screen.getByText('Capa · Preto')).toBeInTheDocument();
    expect(screen.queryByText(/codigo_que_nao_existe|missão|Erro:/)).toBeNull();
  });
});

describe('imagemValida', () => {
  const W = 1200; const H = 1540;
  /** Canvas no tamanho natural: cada `getImageData(x, y, 1, 1)` devolve o pixel da função. */
  const comImagem = (pixel: (x: number, y: number) => [number, number, number]) => {
    const lidos: Array<[number, number]> = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: (x: number, y: number) => { lidos.push([x, y]); return { data: new Uint8ClampedArray([...pixel(x, y), 255]) }; },
    } as never);
    return lidos;
  };
  const img = (w = W) => {
    const i = document.createElement('img');
    Object.defineProperty(i, 'complete', { value: true });
    Object.defineProperty(i, 'naturalWidth', { value: w });
    Object.defineProperty(i, 'naturalHeight', { value: w ? H : 0 });
    return i;
  };
  const real = async () => (await vi.importActual<typeof import('@/lib/galeria/exibicao')>('@/lib/galeria/exibicao')).imagemValida;
  afterEach(() => vi.restoreAllMocks());

  it('toda branca → false, lendo 64 pixels espalhados pelo original', async () => {
    const lidos = comImagem(() => [255, 255, 255]);
    expect((await real())(img())).toBe(false);
    expect(lidos).toHaveLength(64);
    expect(Math.max(...lidos.map(([x]) => x))).toBeGreaterThan(W * 0.8);
    expect(Math.max(...lidos.map(([, y]) => y))).toBeGreaterThan(H * 0.8);
  });

  it('produto pequeno (300×300 no centro) em fundo branco → true', async () => {
    comImagem((x, y) => (Math.abs(x - W / 2) < 150 && Math.abs(y - H / 2) < 150 ? [40, 30, 90] : [255, 255, 255]));
    expect((await real())(img())).toBe(true);
  });

  it('não decodificou → false; canvas indisponível ou contaminado → lança (indeterminado)', async () => {
    const f = await real();
    expect(f(img(0))).toBe(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => f(img())).toThrow();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), getImageData: () => { throw new DOMException('tainted', 'SecurityError'); },
    } as never);
    expect(() => f(img())).toThrow();
  });
  it('é a função usada pelo cartão (mock só neste arquivo)', () => { expect(imagemValida).toBe(valida.fn); });
});

/** A galeria em página própria, no MLB da rota. */
const pagina = (ml: string) => render(
  <MemoryRouter initialEntries={[`/publicados/${ml}/galeria`]}>
    <Routes><Route path="/publicados/:mlItemId/galeria" element={<GaleriaIA />} /></Routes>
  </MemoryRouter>,
);
async function abrirGerar() {
  const b = await screen.findByRole('button', { name: /Gerar e aprovar/ });
  await waitFor(() => expect(b).toBeEnabled());
  await userEvent.click(b);
}

describe('GaleriaIA: passo Gerar', () => {
  it('linhas split da mesma família: cada galeria lista, gera e confirma com o ml_item_id da sua linha', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ ...respRoteiro(), moda: false, familia_id: 'F1' }));
    for (const ml of ['MLB-A', 'MLB-B']) {
      vi.clearAllMocks();
      api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
      api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
      api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
      const r = pagina(ml);
      await abrirGerar();
      fireEvent.load(await screen.findByAltText('Capa · Preto'));
      await gerar();
      expect(api.listarImagens).toHaveBeenCalledWith(ml);
      expect(api.listarImagens.mock.calls.every((c) => c[0] === ml)).toBe(true);
      await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith(ml, ['i1']));
      expect(api.gerarImagens.mock.calls[0][0]).toBe(ml);
      // Task 12: preparar e aprovar também levam o ml_item_id da própria linha.
      api.prepararUploadFinal.mockResolvedValue(ok({ path: 'p', token: 't', signed_url: 'u' }));
      api.enviarFinal.mockResolvedValue(null);
      api.aprovarFinal.mockResolvedValue(ok({ status: 'aprovada' }));
      compor.fn.mockResolvedValue(new Blob(['x']));
      await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
      await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalledWith(ml, 'i1', undefined));
      expect(api.prepararUploadFinal).toHaveBeenCalledWith(ml, 'i1');
      r.unmount();
    }
  });

  it('rascunho v3 sobre o v2 aprovado: passo Gerar continua, com as imagens do v2', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ ...respRoteiro('rascunho', 3), moda: false, familia_id: 'F1' }));
    api.listarImagens.mockResolvedValue(ok(lista([imagem()], 50, aprovado(undefined, { versao: 2 }))));
    pagina('MLB1');
    await abrirGerar();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']));
  });

  it('sem roteiro aprovado mas com imagem pendente de exibição (família anterior): passo Gerar abre', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda: false, familia_id: 'F1' }));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ pode_gerar_de_novo: false })], 50, null)));
    pagina('MLB1');
    await abrirGerar();
    expect(await screen.findByAltText('Capa · Preto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Gerar \d+ imagens? ·/ })).toBeNull();
  });

  it('sem roteiro aprovado nem imagem pendente o passo Gerar fica fechado', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda: false, familia_id: 'F1' }));
    api.listarImagens.mockResolvedValue(ok(lista([], 50, null)));
    pagina('MLB1');
    await screen.findByText('Conferir dados', { selector: 'h1' });
    expect(screen.getByRole('button', { name: /Gerar e aprovar/ })).toBeDisabled();
  });
});
