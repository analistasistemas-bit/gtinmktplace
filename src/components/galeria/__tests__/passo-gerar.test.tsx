import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PassoGerar } from '../passo-gerar';
import { CartaoImagem } from '../cartao-imagem';
import { DialogGaleria } from '../dialog-galeria';
import { imagemValida } from '@/lib/galeria/exibicao';
import type { Ficha, ImagemGaleria, RespostaListar, RespostaRoteiro, Res, RoteiroAprovado } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({
  montarFicha: vi.fn(), lerRoteiro: vi.fn(), listarImagens: vi.fn(), gerarImagens: vi.fn(),
  confirmarExibicao: vi.fn(), reportarInvalida: vi.fn(),
}));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));
vi.mock('@/lib/storage', () => ({ signedUrl: vi.fn(async () => 'https://x.test/e.jpg') }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const valida = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/galeria/exibicao', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/exibicao')>()), imagemValida: valida.fn }));

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (status: number, erro: string, corpo: Record<string, unknown> = {}): Res<never> => ({ ok: false, status, erro, corpo: { error: erro, ...corpo } });

const ficha = (cores: string[]): Ficha => ({
  anuncio_externo_id: 'A1', familia_id: 'F1', codigo_pai: '0001', cores, fatos: [], fatos_hash: 'h', roteiro_desatualizado: false, referencias: {},
});
const missao = (n: number, ativa = true) => ({ missao: n, ativa, cena: `cena ${n}`, fatosUsados: [] });
const aprovado = (ativas = [1, 2, 3, 4, 5, 6, 7], extra: Partial<RoteiroAprovado> = {}): RoteiroAprovado =>
  ({ id: 'R1', versao: 3, familia_id: 'F1', moda: false, missoes_ativas: ativas, ...extra });
/** Resposta do `ler` (aba Roteiro). */
const respRoteiro = (status = 'aprovado', versao = 3): RespostaRoteiro => ({
  roteiro: { id: `R${versao}`, familia_id: 'F1', versao, status, moda: false,
    conteudo: { categoria: 'c', contrato: 'k', missoes: [1, 2, 3, 4, 5, 6, 7].map((n) => missao(n)) } },
  erros: [], erros_por_missao: {}, ciencia_pendente: [], fatos: [],
});
const imagem = (extra: Partial<ImagemGaleria> = {}): ImagemGaleria => ({
  id: 'i1', cor: 'Preto', missao: 1, geracao: 1, origem: 'gerador', status: 'gerada', alertas: [], erro: null,
  exibida: false, url: 'https://signed/i1.png', pode_gerar_de_novo: true, unit_cents: 50, ...extra,
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
const marcadas = () => screen.getAllByRole('checkbox', { name: /^Missão \d/ })
  .filter((c) => c.getAttribute('data-state') === 'checked').map((c) => c.getAttribute('aria-label'));

beforeEach(() => {
  vi.clearAllMocks();
  valida.fn.mockReturnValue(true);
  api.listarImagens.mockResolvedValue(ok(lista()));
  api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
  api.reportarInvalida.mockResolvedValue(ok({ reportada: true }));
  api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
});
afterEach(() => { vi.useRealTimers(); });

describe('PassoGerar — seleção e confirmação', () => {
  it('missões pré-marcadas por missoesSugeridas (até 3 cores: as sete ativas; 4+ cores: 1–4)', async () => {
    passo(['A', 'B', 'C'], aprovado([1, 2, 3, 5, 7]));
    await screen.findByText(/por imagem/);
    expect(marcadas()).toEqual(['Missão 1', 'Missão 2', 'Missão 3', 'Missão 5', 'Missão 7']);
  });

  it('com 4 cores só 1–4 vêm marcadas', async () => {
    passo(['A', 'B', 'C', 'D']);
    await screen.findByText(/por imagem/);
    expect(marcadas()).toEqual(['Missão 1', 'Missão 2', 'Missão 3', 'Missão 4']);
  });

  it('confirmação mostra "N imagens · R$ X" com o preço do servidor; recortes não entram', async () => {
    passo(['Preto', 'Rosa']);
    await screen.findByText(/por imagem/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    // 2 cores × 6 missões com gerador (a 7 é recorte) = 12 × R$ 0,50 = R$ 6,00.
    expect(screen.getByText(/12 imagens · R\$\s6,00/)).toBeInTheDocument();
    expect(screen.getByText(/2 recortes grátis/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    const [ml, p] = api.gerarImagens.mock.calls[0];
    expect(ml).toBe('MLB1');
    expect(p).toMatchObject({ roteiroVersao: 3, cores: ['Preto', 'Rosa'], missoes: [1, 2, 3, 4, 5, 6, 7], unitCentsExibido: 50 });
    expect(p.pedidoId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preco_mudou mostra o preço novo e pede nova confirmação com outro pedido_id', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'preco_mudou', { unit_cents: 80 }));
    passo();
    await screen.findByText(/por imagem/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(/preço mudou/i)).toBeInTheDocument();
    expect(screen.getByText(/6 imagens · R\$\s4,80/)).toBeInTheDocument();
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(api.gerarImagens).toHaveBeenCalledTimes(2);
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(b.unitCentsExibido).toBe(80);
    expect(b.pedidoId).not.toBe(a.pedidoId);
  });

  it('recusa definitiva: motivo em português e confirmação desabilitada, sem nova tentativa', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'teto', { bloqueadas: [{ cor: 'Preto', missao: 1, motivo: 'teto' }] }));
    passo();
    await screen.findByText(/por imagem/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(/limite de 3 gerações/i)).toBeInTheDocument();
    expect(screen.getByText(/Preto · missão 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
  });

  it('ml_indisponivel: tentar de novo reusa o mesmo pedido_id', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(503, 'ml_indisponivel'));
    passo();
    await screen.findByText(/por imagem/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(/Mercado Livre indisponível, tente de novo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(b.pedidoId).toBe(a.pedidoId);
  });

  it('familia_nao_vigente: botão Recarregar visível e Confirmar desabilitado', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'familia_nao_vigente', { familia_id_vigente: 'F2' }));
    const props = passo();
    await screen.findByText(/por imagem/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Recarregar' }));
    expect(props.aoRecarregar).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
  });

  it('roteiro aprovado de família anterior: imagens visíveis, pedido novo bloqueado com aviso', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem()], 50, aprovado(undefined, { familia_id: 'F-antiga' }))));
    passo();
    expect(await screen.findByAltText('Preto · missão 1')).toBeInTheDocument();
    expect(screen.getByText(/família anterior/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar imagens' })).toBeNull();
  });

  it('ciência pendente volta ao roteiro', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'conteudo.ciencia_nao_conferido', { campos: ['Material'] }));
    const props = passo();
    await screen.findByText(/por imagem/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar ao roteiro' }));
    expect(props.aoVoltarRoteiro).toHaveBeenCalled();
  });
});

describe('PassoGerar — exibição e cobrança', () => {
  it('listar → imagem válida confirma uma vez, mesmo com polls seguintes (URL estável)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem(), imagem({ id: 'i2', status: 'gerando', url: null })])));
    passo();
    const img = await screen.findByAltText('Preto · missão 1');
    fireEvent.load(img);
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ url: 'https://signed/outra.png', exibida: true }), imagem({ id: 'i2', status: 'gerando', url: null })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    expect(screen.getByAltText('Preto · missão 1')).toHaveAttribute('src', 'https://signed/i1.png');
    fireEvent.load(screen.getByAltText('Preto · missão 1'));
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(1);
  });

  it('imagem branca → reportar_invalida e nenhuma confirmação', async () => {
    valida.fn.mockReturnValue(false);
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.load(await screen.findByAltText('Preto · missão 1'));
    await waitFor(() => expect(api.reportarInvalida).toHaveBeenCalledWith('MLB1', 'i1'));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
  });

  it('canvas contaminado (exceção na validação) → nem confirma nem reporta', async () => {
    valida.fn.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.load(await screen.findByAltText('Preto · missão 1'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
    expect(api.reportarInvalida).not.toHaveBeenCalled();
  });

  it('já exibida e recorte não chamam confirmação', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ exibida: true }), imagem({ id: 'r', missao: 7, origem: 'recorte' })])));
    passo();
    fireEvent.load(await screen.findByAltText('Preto · missão 1'));
    fireEvent.load(screen.getByAltText('Preto · missão 7'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
  });

  it('polling para quando tudo é terminal e os alertas chegaram; para ao desmontar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ alertas: null })])));
    const { unmount } = render(<PassoGerar mlItemId="MLB1" ficha={ficha(['Preto'])} aoRecarregar={vi.fn()} aoVoltarRoteiro={vi.fn()} />);
    await screen.findByAltText('Preto · missão 1');
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
    await screen.findByAltText('Preto · missão 1');
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(1);
  });

  it('listar com 503 continua o polling; com 4xx para', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValueOnce(falha(503, 'falha_interna')).mockResolvedValue(ok(lista([imagem()])));
    passo();
    expect(await screen.findByText(/Erro/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(await screen.findByAltText('Preto · missão 1')).toBeInTheDocument();
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

  it('recusa definitiva seguida de poll com falha mantém o Confirmar desabilitado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValueOnce(ok(lista([imagem({ status: 'gerando', url: null })]))).mockResolvedValue(falha(503, 'falha_interna'));
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'teto', { bloqueadas: [{ cor: 'Preto', missao: 1, motivo: 'teto' }] }));
    passo();
    await screen.findByText(/por imagem/);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await screen.findByText(/limite de 3 gerações/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(screen.getByText(/limite de 3 gerações/i)).toBeInTheDocument();
  });

  it('falha de carga não é terminal: aviso, sem cobrar nem reportar; o poll seguinte tenta com URL nova e cobra', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.error(await screen.findByAltText('Preto · missão 1'));
    expect(await screen.findByText(/Não foi possível exibir a imagem/)).toBeInTheDocument();
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
    expect(api.reportarInvalida).not.toHaveBeenCalled();
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ url: 'https://signed/nova.png' })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const img = await screen.findByAltText('Preto · missão 1');
    expect(img).toHaveAttribute('src', 'https://signed/nova.png');
    fireEvent.load(img);
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']));
  });

  it('confirmação com rede/5xx: o poll seguinte repete até a imagem ficar exibida', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.confirmarExibicao.mockResolvedValueOnce(falha(503, 'falha_interna')).mockResolvedValue(ok({ cobradas: 1 }));
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    passo();
    fireEvent.load(await screen.findByAltText('Preto · missão 1'));
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(2));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ exibida: true })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(2);
  });

  it('preço: a imagem mostra o do pedido (50); a confirmação de pedido novo, o do mês (80)', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ unit_cents: 50 })], 80)));
    passo();
    expect(await screen.findByText(/R\$\s0,50 ao exibir/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
    expect(screen.getByText(/6 imagens · R\$\s4,80/)).toBeInTheDocument();
  });

  it('"Gerar de novo" abre a confirmação de 1 imagem daquela cor e missão', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ cor: 'Rosa', missao: 2 })])));
    passo(['Preto', 'Rosa']);
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar de novo' }));
    expect(screen.getByText(/1 imagem · R\$\s0,50/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(api.gerarImagens.mock.calls[0][1]).toMatchObject({ cores: ['Rosa'], missoes: [2] });
  });
});

describe('CartaoImagem', () => {
  it('mostra os alertas da verificação', () => {
    render(<CartaoImagem imagem={imagem({ alertas: [{ tipo: 'cor', nota: 'Cor diferente da referência' }] })} onGerarDeNovo={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Cor diferente da referência');
  });

  it('"Gerar de novo" some quando o servidor diz que a vaga acabou (teto ou em andamento)', () => {
    render(<CartaoImagem imagem={imagem({ pode_gerar_de_novo: false })} onGerarDeNovo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Gerar de novo' })).toBeNull();
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

describe('DialogGaleria — aba Gerar', () => {
  it('linhas split da mesma família: cada galeria lista, gera e confirma com o ml_item_id da sua linha', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ ...respRoteiro(), moda: false, familia_id: 'F1' }));
    for (const ml of ['MLB-A', 'MLB-B']) {
      vi.clearAllMocks();
      api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
      api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
      api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
      const r = render(<DialogGaleria mlItemId={ml} codigoPai="0001" open onOpenChange={() => undefined} isAdmin />);
      await userEvent.click(await screen.findByRole('tab', { name: /Gerar/ }));
      fireEvent.load(await screen.findByAltText('Preto · missão 1'));
      await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
      expect(api.listarImagens).toHaveBeenCalledWith(ml);
      expect(api.listarImagens.mock.calls.every((c) => c[0] === ml)).toBe(true);
      await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith(ml, ['i1']));
      expect(api.gerarImagens.mock.calls[0][0]).toBe(ml);
      r.unmount();
    }
  });

  it('rascunho v3 sobre o v2 aprovado: aba Gerar continua, com as imagens do v2', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ ...respRoteiro('rascunho', 3), moda: false, familia_id: 'F1' }));
    api.listarImagens.mockResolvedValue(ok(lista([imagem()], 50, aprovado(undefined, { versao: 2 }))));
    render(<DialogGaleria mlItemId="MLB1" codigoPai="0001" open onOpenChange={() => undefined} isAdmin />);
    await userEvent.click(await screen.findByRole('tab', { name: /Gerar/ }));
    fireEvent.load(await screen.findByAltText('Preto · missão 1'));
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']));
  });

  it('sem roteiro aprovado mas com imagem pendente de exibição (família anterior): aba Gerar aparece', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda: false, familia_id: 'F1' }));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ pode_gerar_de_novo: false })], 50, null)));
    render(<DialogGaleria mlItemId="MLB1" codigoPai="0001" open onOpenChange={() => undefined} isAdmin />);
    await userEvent.click(await screen.findByRole('tab', { name: /Gerar/ }));
    expect(await screen.findByAltText('Preto · missão 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar imagens' })).toBeNull();
  });

  it('sem roteiro aprovado nem imagem pendente não há aba Gerar', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda: false, familia_id: 'F1' }));
    api.listarImagens.mockResolvedValue(ok(lista([], 50, null)));
    render(<DialogGaleria mlItemId="MLB1" codigoPai="0001" open onOpenChange={() => undefined} isAdmin />);
    await screen.findByRole('tab', { name: /Roteiro/ });
    expect(screen.queryByRole('tab', { name: /Gerar/ })).toBeNull();
  });
});
