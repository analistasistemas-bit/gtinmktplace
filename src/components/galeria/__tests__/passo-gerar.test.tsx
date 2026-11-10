import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PassoGerar } from '../passo-gerar';
import { CartaoImagem } from '../cartao-imagem';
import { DialogGaleria } from '../dialog-galeria';
import { imagemValida } from '@/lib/galeria/exibicao';
import type { Ficha, ImagemGaleria, RespostaListar, RespostaRoteiro, Res } from '@/lib/galeria/api';

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
const aprovado = (ativas = [1, 2, 3, 4, 5, 6, 7], moda = false): RespostaRoteiro => ({
  roteiro: { id: 'R1', familia_id: 'F1', versao: 3, status: 'aprovado', moda,
    conteudo: { categoria: 'c', contrato: 'k', missoes: [1, 2, 3, 4, 5, 6, 7].map((n) => missao(n, ativas.includes(n))) } },
  erros: [], erros_por_missao: {}, ciencia_pendente: [], fatos: [],
});
const imagem = (extra: Partial<ImagemGaleria> = {}): ImagemGaleria => ({
  id: 'i1', cor: 'Preto', missao: 1, geracao: 1, origem: 'gerador', status: 'gerada', alertas: [], erro: null,
  exibida: false, url: 'https://signed/i1.png', pode_gerar_de_novo: true, ...extra,
});
const lista = (imagens: ImagemGaleria[] = [], unit = 50): RespostaListar => ({ roteiro_id: 'R1', unit_cents: unit, imagens });

function passo(cores = ['Preto'], resp = aprovado(), mlItemId = 'MLB1') {
  const props = { aoRecarregar: vi.fn(), aoVoltarRoteiro: vi.fn() };
  render(<PassoGerar mlItemId={mlItemId} ficha={ficha(cores)} resp={resp} {...props} />);
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

  it('ciência pendente volta ao roteiro; família não vigente oferece recarregar', async () => {
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
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ url: 'https://signed/outra.png' }), imagem({ id: 'i2', status: 'gerando', url: null })])));
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
    const { unmount } = render(<PassoGerar mlItemId="MLB1" ficha={ficha(['Preto'])} resp={aprovado()} aoRecarregar={vi.fn()} aoVoltarRoteiro={vi.fn()} />);
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
  const comPixels = (px: number[][]) => {
    const data = new Uint8ClampedArray(px.flatMap(([r, g, b]) => [r, g, b, 255]));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data }) } as never);
  };
  const img = (w = 1200) => {
    const i = document.createElement('img');
    Object.defineProperty(i, 'complete', { value: true });
    Object.defineProperty(i, 'naturalWidth', { value: w });
    Object.defineProperty(i, 'naturalHeight', { value: w ? 1540 : 0 });
    return i;
  };
  afterEach(() => vi.restoreAllMocks());

  it('branca → false; produto sobre fundo branco → true; não decodificou → false', async () => {
    const { imagemValida: real } = await vi.importActual<typeof import('@/lib/galeria/exibicao')>('@/lib/galeria/exibicao');
    comPixels(Array.from({ length: 64 }, () => [255, 255, 255]));
    expect(real(img())).toBe(false);
    comPixels(Array.from({ length: 64 }, (_, i) => (i % 3 === 0 ? [40, 30, 90] : [255, 255, 255])));
    expect(real(img())).toBe(true);
    expect(real(img(0))).toBe(false);
  });
  it('é a função usada pelo cartão (mock só neste arquivo)', () => { expect(imagemValida).toBe(valida.fn); });
});

describe('DialogGaleria — aba Gerar', () => {
  it('linhas split da mesma família: cada galeria lista, gera e confirma com o ml_item_id da sua linha', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ ...aprovado(), moda: false, familia_id: 'F1' }));
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    for (const ml of ['MLB-A', 'MLB-B']) {
      vi.clearAllMocks();
      api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
      api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
      const r = render(<DialogGaleria mlItemId={ml} codigoPai="0001" open onOpenChange={() => undefined} isAdmin />);
      await userEvent.click(await screen.findByRole('tab', { name: /Gerar/ }));
      fireEvent.load(await screen.findByAltText('Preto · missão 1'));
      await userEvent.click(screen.getByRole('button', { name: 'Gerar imagens' }));
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
      expect(api.listarImagens).toHaveBeenCalledWith(ml, 3);
      await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith(ml, ['i1']));
      expect(api.gerarImagens.mock.calls[0][0]).toBe(ml);
      r.unmount();
    }
  });

  it('sem roteiro aprovado não há aba Gerar', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha(['Preto'])));
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda: false, familia_id: 'F1' }));
    render(<DialogGaleria mlItemId="MLB1" codigoPai="0001" open onOpenChange={() => undefined} isAdmin />);
    await screen.findByRole('tab', { name: /Roteiro/ });
    expect(screen.queryByRole('tab', { name: /Gerar/ })).toBeNull();
  });
});
