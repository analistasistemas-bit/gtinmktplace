import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PainelImagens } from '../painel-imagens';
import { CartaoImagem } from '../cartao-imagem';
import { imagemValida } from '@/lib/galeria/exibicao';
import type { ImagemGaleria, PosicaoGaleria, RespostaListar, Res } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({
  listarImagens: vi.fn(), gerarImagens: vi.fn(), confirmarExibicao: vi.fn(), reportarInvalida: vi.fn(),
  prepararUploadFinal: vi.fn(), enviarFinal: vi.fn(), aprovarFinal: vi.fn(),
}));
const final = vi.hoisted(() => ({ fn: vi.fn() }));
const valida = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));
vi.mock('@/lib/galeria/final', () => ({ montarArquivoFinal: final.fn }));
vi.mock('@/lib/galeria/exibicao', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/exibicao')>()), imagemValida: valida.fn }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (status: number, erro: string, corpo: Record<string, unknown> = {}): Res<never> => ({ ok: false, status, erro, corpo: { error: erro, ...corpo } });

const NOMES = ['Capa', 'Em uso', 'Tira-dúvida', 'Benefícios', 'Ficha técnica', 'Como usar', 'Detalhes'];
const posicoes = (indisponiveis: Record<number, string> = {}): PosicaoGaleria[] =>
  NOMES.map((nome, k) => ({ posicao: k + 1, nome, ...(indisponiveis[k + 1] ? { indisponivel: indisponiveis[k + 1] } : {}) }));
const imagem = (extra: Partial<ImagemGaleria> = {}): ImagemGaleria => ({
  id: 'i1', cor: 'Preto', missao: 1, geracao: 1, status: 'gerada', alertas: [], erro: null,
  exibida: false, url: 'https://signed/i1.png', roteiro_id: 'P1', pode_gerar_de_novo: true, unit_cents: 50, ...extra,
});
const lista = (imagens: ImagemGaleria[] = [], extra: Partial<RespostaListar> = {}): RespostaListar =>
  ({ titulo: 'Fita', cores: ['Preto'], moda: false, unit_cents: 50, posicoes: posicoes(), plano_id: 'P1', imagens, ...extra });
const GERAR = /^Gerar · R\$\s0,50$/;
const coresN = (n: number) => Array.from({ length: n }, (_, k) => `Cor ${k + 1}`);

function painel(cor: string | null = 'Preto', mlItemId = 'MLB1') {
  return render(<PainelImagens mlItemId={mlItemId} cor={cor} />);
}
/** Cartão de uma imagem pelo nome (com várias cores, o n-ésimo). */
const cartaoDe = (el: HTMLElement) => el.closest('[data-estado]') as HTMLElement;
const cartao = (nome: string, n = 0) => cartaoDe(screen.getAllByText(nome, { selector: 'span.font-semibold' })[n]);
const esperaCartao = async (nome: string) => cartaoDe(await screen.findByText(nome, { selector: 'span.font-semibold' }));
const dialogo = () => screen.getByRole('dialog');
const confirmarGeracao = () => userEvent.click(within(dialogo()).getByRole('button', { name: /^(Confirmar|Tentar de novo)$/ }));

beforeEach(() => {
  vi.clearAllMocks();
  valida.fn.mockReturnValue(true);
  api.listarImagens.mockResolvedValue(ok(lista()));
  api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
  api.reportarInvalida.mockResolvedValue(ok({ reportada: true }));
  api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
  final.fn.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  api.prepararUploadFinal.mockResolvedValue(ok({ path: 'org/galeria-ia/F1/finais/i1-n.jpg', token: 't', signed_url: 'u' }));
  api.enviarFinal.mockResolvedValue(null);
  api.aprovarFinal.mockResolvedValue(ok({ status: 'aprovada' }));
});
afterEach(() => { vi.useRealTimers(); });

describe('PainelImagens: grade e geração', () => {
  it('mostra 7 cartões com os nomes das imagens mesmo sem plano', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([], { plano_id: null })));
    painel();
    await screen.findByText('Capa');
    expect(document.querySelectorAll('[data-estado]')).toHaveLength(7);
    NOMES.forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: GERAR })).toHaveLength(7);
  });

  it('"Gerar" de um cartão pede só aquela imagem e cor, após confirmar o valor', async () => {
    painel();
    await userEvent.click(within(await esperaCartao('Benefícios')).getByRole('button', { name: GERAR }));
    expect(within(dialogo()).getByText('1 imagem · R$ 0,50')).toBeInTheDocument();
    expect(api.gerarImagens).not.toHaveBeenCalled();
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens).toHaveBeenCalledTimes(1));
    const [ml, p] = api.gerarImagens.mock.calls[0];
    expect(ml).toBe('MLB1');
    expect(p).toMatchObject({ cores: ['Preto'], missoes: [4], unitCentsExibido: 50 });
    expect(p.pedidoId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('"Gerar todas" pede as imagens disponíveis que ainda não têm imagem viva da cor', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([
      imagem({ id: 'a', missao: 1, status: 'aprovada' }), imagem({ id: 'b', missao: 2, status: 'gerando', url: null }),
      imagem({ id: 'c', missao: 3, status: 'falhou', url: null, erro: 'timeout' }),
    ], { posicoes: posicoes({ 5: 'Faltam dados do produto para esta imagem.' }) })));
    painel();
    const botao = await screen.findByRole('button', { name: /^Gerar todas/ });
    expect(botao).toHaveTextContent('Gerar todas (4 imagens · R$ 2,00)');
    await userEvent.click(botao);
    expect(within(dialogo()).getByText('4 imagens · R$ 2,00')).toBeInTheDocument();
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens).toHaveBeenCalledTimes(1));
    expect(api.gerarImagens.mock.calls[0][1]).toMatchObject({ cores: ['Preto'], missoes: [3, 4, 6, 7] });
  });

  it('"Todas as cores": pedidos de até 5 cores, em sequência; recusa no 2º pedido para e mostra o motivo, o 1º segue gerando', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([], { cores: coresN(12) })));
    api.gerarImagens.mockResolvedValueOnce(ok({ pedido_id: 'p1', imagens: [] }))
      .mockResolvedValueOnce(falha(409, 'teto', { bloqueadas: [{ cor: 'Cor 6', missao: 1 }] }));
    painel(null);
    await userEvent.click(await screen.findByRole('button', { name: /^Gerar todas/ }));
    expect(within(dialogo()).getByText('84 imagens · R$ 42,00')).toBeInTheDocument();
    expect(within(dialogo()).getByText('Enviado em 3 pedidos, um depois do outro.')).toBeInTheDocument();
    await confirmarGeracao();
    expect(await within(dialogo()).findByText(/gerou esta imagem 3 vezes/i)).toBeInTheDocument();
    expect(within(dialogo()).getByText(/O 1º pedido já foi enviado e segue gerando/)).toBeInTheDocument();
    expect(api.gerarImagens).toHaveBeenCalledTimes(2);
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(a.cores).toEqual(coresN(12).slice(0, 5));
    expect(b.cores).toEqual(coresN(12).slice(5, 10));
    expect(a.pedidoId).not.toBe(b.pedidoId);
    // O diálogo mostra o que sobrou (2 pedidos: 5 + 2 cores = 49 imagens), com o botão travado pela recusa.
    expect(within(dialogo()).getByText('49 imagens · R$ 24,50')).toBeInTheDocument();
    expect(within(dialogo()).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });

  it('"Todas as cores" faz uma faixa por cor, com o nome da cor', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([], { cores: ['Branco', 'Preto'] })));
    painel(null);
    await screen.findAllByText('Capa');
    expect(screen.getByRole('heading', { name: 'Branco' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Preto' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-estado]')).toHaveLength(14);
  });

  it('diálogo mostra "273 imagens · R$ 136,50" para 39 cores × 7 a R$ 0,50', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([], { cores: coresN(39) })));
    painel(null);
    await userEvent.click(await screen.findByRole('button', { name: /^Gerar todas/ }));
    expect(within(dialogo()).getByText('273 imagens · R$ 136,50')).toBeInTheDocument();
    expect(within(dialogo()).getByText('Enviado em 8 pedidos, um depois do outro.')).toBeInTheDocument();
  });

  it('422 posicao_indisponivel: relista e reabre o diálogo com a quantidade e o total novos', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(422, 'posicao_indisponivel', { missoes: [5] }));
    painel();
    await userEvent.click(await screen.findByRole('button', { name: /^Gerar todas/ }));
    expect(within(dialogo()).getByText('7 imagens · R$ 3,50')).toBeInTheDocument();
    api.listarImagens.mockResolvedValue(ok(lista([], { posicoes: posicoes({ 5: 'Faltam dados do produto para esta imagem.' }) })));
    await confirmarGeracao();
    expect(await within(dialogo()).findByText('6 imagens · R$ 3,00')).toBeInTheDocument();
    expect(within(dialogo()).getByText(/Faltam dados do produto para algumas imagens/)).toBeInTheDocument();
    expect(within(dialogo()).getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens).toHaveBeenCalledTimes(2));
    expect(api.gerarImagens.mock.calls[1][1]).toMatchObject({ missoes: [1, 2, 3, 4, 6, 7] });
    expect(api.gerarImagens.mock.calls[1][1].pedidoId).not.toBe(api.gerarImagens.mock.calls[0][1].pedidoId);
  });

  it('409 plano_desatualizado: diálogo "12 imagens prontas deixam de valer. Gerar mesmo assim?"; confirmar reenvia com confirmarTroca', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'plano_desatualizado', { imagens: 12 }));
    painel();
    await userEvent.click(within(await esperaCartao('Capa')).getByRole('button', { name: GERAR }));
    await confirmarGeracao();
    expect(await screen.findByText('12 imagens prontas deixam de valer. Gerar mesmo assim?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gerar mesmo assim' }));
    await waitFor(() => expect(api.gerarImagens).toHaveBeenCalledTimes(2));
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(a.confirmarTroca).toBeFalsy();
    expect(b.confirmarTroca).toBe(true);
    expect(b.pedidoId).toBe(a.pedidoId);
    expect(b.missoes).toEqual([1]);
  });

  it('enquanto um pedido está em voo, todos os botões Gerar ficam desabilitados', async () => {
    let liberar!: (r: Res<unknown>) => void;
    api.gerarImagens.mockReturnValue(new Promise((r) => { liberar = r; }));
    painel();
    await userEvent.click(within(await esperaCartao('Capa')).getByRole('button', { name: /^Gerar ·/ }));
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens).toHaveBeenCalled());
    const botoes = screen.getAllByRole('button', { name: /^Gerar( |$)/, hidden: true });
    expect(botoes.length).toBeGreaterThan(7);
    botoes.forEach((b) => expect(b).toBeDisabled());
    await act(async () => { liberar(ok({ pedido_id: 'p', imagens: [] })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cartão indisponível mostra o motivo e não tem botão', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([], { posicoes: posicoes({ 5: 'Faltam dados do produto para esta imagem.' }) })));
    painel();
    const c = await esperaCartao('Ficha técnica');
    expect(c).toHaveAttribute('data-estado', 'indisponivel');
    expect(within(c).getByText('Faltam dados do produto para esta imagem.')).toBeInTheDocument();
    expect(within(c).queryByRole('button')).toBeNull();
  });

  it('não escreve "posição", "plano", "missão" nem "roteiro" na tela', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2 }), imagem({ id: 'f', missao: 6, status: 'falhou', url: null, erro: 'codigo_estranho' })])));
    painel();
    await screen.findByText('Em uso');
    expect(document.body.textContent).not.toMatch(/posi[cç][aã]o|plano|miss[aã]o|roteiro|codigo_estranho/i);
  });
});

describe('PainelImagens: estados do cartão', () => {
  it('alerta texto_extra aparece no cartão e não bloqueia Aprovar', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2, alertas: [
      { tipo: 'texto_extra', nota: '"Super oferta"' }, { tipo: 'texto_faltando', nota: 'Prende firme' }, { tipo: 'verificacao_indisponivel', nota: '' },
    ] })])));
    painel();
    const c = await esperaCartao('Em uso');
    expect(within(c).getByText('Texto a mais na imagem: "Super oferta"')).toBeInTheDocument();
    expect(within(c).getByText('Faltou ou saiu errado o texto: Prende firme')).toBeInTheDocument();
    expect(within(c).getByText('Não foi possível conferir o texto. Confira antes de aprovar.')).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Aprovar' })).toBeEnabled();
  });

  it('imagem de plano antigo (roteiro_id ≠ plano_id) aparece sem Aprovar e com a nota', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2, roteiro_id: 'P0' })])));
    painel();
    await screen.findByAltText('Em uso · Preto');
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(screen.getByText('Imagem de uma versão anterior. Gere de novo.')).toBeInTheDocument();
  });

  it('sem plano ainda: imagem antiga não aprovada conta como faltando para o Gerar todas', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2, roteiro_id: 'P0' })], { plano_id: null })));
    painel();
    expect(await screen.findByRole('button', { name: /^Gerar todas/ })).toHaveTextContent('Gerar todas (7 imagens · R$ 3,50)');
  });

  it('imagem com alertas null segue como "Gerando…" (sem imagem na tela) e mantém o polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ alertas: null })])));
    painel();
    const c = await esperaCartao('Capa');
    expect(c).toHaveAttribute('data-estado', 'gerando');
    expect(within(c).getByText('Gerando…')).toBeInTheDocument();
    // Neon girando só no cartão que está gerando.
    expect(c.querySelector('.border-trail__track')).not.toBeNull();
    expect(cartao('Em uso').querySelector('.border-trail__track')).toBeNull();
    expect(screen.queryByAltText('Capa · Preto')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ alertas: [] })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(await screen.findByAltText('Capa · Preto')).toBeInTheDocument();
  });

  it('falhou no limite de 3 gerações: mensagem e nenhum "Tentar de novo"', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([
      imagem({ id: 'f', missao: 2, geracao: 3, status: 'falhou', url: null, erro: 'teto', pode_gerar_de_novo: false }),
      imagem({ id: 'g', missao: 3, geracao: 3, status: 'falhou', url: null, erro: 'timeout', pode_gerar_de_novo: false }),
    ])));
    painel();
    for (const nome of ['Em uso', 'Tira-dúvida']) {
      await esperaCartao(nome);
      const c = cartao(nome);
      expect(within(c).getByText('Você já gerou esta imagem 3 vezes.')).toBeInTheDocument();
      expect(within(c).queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    }
  });

  it('aprovada: selo "Aprovada" e "Gerar outra"; falhou: motivo e "Tentar de novo"', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([
      imagem({ id: 'a', missao: 1, status: 'aprovada', exibida: true }), imagem({ id: 'f', missao: 2, status: 'falhou', url: null, erro: 'timeout' }),
    ])));
    painel();
    const a = await esperaCartao('Capa');
    expect(within(a).getByText('Aprovada')).toBeInTheDocument();
    expect(within(a).getByRole('button', { name: 'Gerar outra' })).toBeInTheDocument();
    expect(within(a).queryByRole('button', { name: 'Aprovar' })).toBeNull();
    const f = cartao('Em uso');
    expect(within(f).getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    await userEvent.click(within(f).getByRole('button', { name: 'Tentar de novo' }));
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens.mock.calls[0][1]).toMatchObject({ cores: ['Preto'], missoes: [2] }));
  });

  it('mostra a geração mais nova; com uma aprovada mais antiga, avisa que ela existe', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([
      imagem({ id: 'v1', status: 'aprovada', geracao: 1, url: 'https://signed/v1.png' }), imagem({ id: 'v2', geracao: 2, url: 'https://signed/v2.png' }),
    ])));
    painel();
    expect(await screen.findByAltText('Capa · Preto')).toHaveAttribute('src', 'https://signed/v2.png');
    expect(screen.getByText('Existe uma versão aprovada desta imagem.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
  });

  it('"Gerar outra" abre a confirmação de 1 imagem, da cor e imagem do cartão', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ cor: 'Rosa', missao: 2 })], { cores: ['Preto', 'Rosa'] })));
    painel('Rosa');
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar outra' }));
    expect(within(dialogo()).getByText('1 imagem · R$ 0,50')).toBeInTheDocument();
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens.mock.calls[0][1]).toMatchObject({ cores: ['Rosa'], missoes: [2] }));
  });

  it('"Gerar outra" some quando o servidor diz que a vaga acabou', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ pode_gerar_de_novo: false })])));
    painel();
    await screen.findByAltText('Capa · Preto');
    expect(screen.queryByRole('button', { name: 'Gerar outra' })).toBeNull();
  });
});

describe('PainelImagens: recusas do pedido', () => {
  const gerarCapa = async () => {
    await userEvent.click(within(await esperaCartao('Capa')).getByRole('button', { name: /^Gerar ·/ }));
    await confirmarGeracao();
  };

  it('preco_mudou mostra o preço novo no diálogo e pede nova confirmação, com outro pedido_id', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'preco_mudou', { unit_cents: 80 }));
    painel();
    await gerarCapa();
    expect(await within(dialogo()).findByText(/preço mudou para R\$\s0,80/i)).toBeInTheDocument();
    expect(within(dialogo()).getByText('1 imagem · R$ 0,80')).toBeInTheDocument();
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens).toHaveBeenCalledTimes(2));
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(b.unitCentsExibido).toBe(80);
    expect(b.pedidoId).not.toBe(a.pedidoId);
  });

  it('recusa definitiva: motivo em português e Confirmar desabilitado, sem nova tentativa', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'teto', { bloqueadas: [{ cor: 'Preto', missao: 1, motivo: 'teto' }] }));
    painel();
    await gerarCapa();
    expect(await within(dialogo()).findByText(/gerou esta imagem 3 vezes/i)).toBeInTheDocument();
    expect(within(dialogo()).getByText('Capa · Preto')).toBeInTheDocument();
    expect(within(dialogo()).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(api.gerarImagens).toHaveBeenCalledTimes(1);
  });

  it.each([['ml_indisponivel', 503], ['rede', 0]])('%s: "Tentar de novo" reusa o mesmo pedido_id', async (erro, status) => {
    api.gerarImagens.mockResolvedValueOnce(falha(status as number, erro as string));
    painel();
    await gerarCapa();
    expect(await within(dialogo()).findByText(/Mercado Livre indisponível, tente de novo/)).toBeInTheDocument();
    await confirmarGeracao();
    await waitFor(() => expect(api.gerarImagens).toHaveBeenCalledTimes(2));
    const [a, b] = api.gerarImagens.mock.calls.map((c) => c[1]);
    expect(b.pedidoId).toBe(a.pedidoId);
    expect(b.cores).toEqual(a.cores);
  });

  it('sem foto de referência: motivo e as cores', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'sem_referencia', { cores: ['Preto'] }));
    painel();
    await gerarCapa();
    expect(await within(dialogo()).findByText('Falta a foto real desta cor no cadastro.')).toBeInTheDocument();
    expect(within(dialogo()).getByText('Preto')).toBeInTheDocument();
  });

  it('nenhuma mensagem do operador mostra código cru', async () => {
    api.gerarImagens.mockResolvedValueOnce(falha(409, 'codigo_que_nao_existe', { bloqueadas: [{ cor: 'Preto', missao: 1 }] }));
    painel();
    await gerarCapa();
    expect(await within(dialogo()).findByText('Não deu certo. Tente de novo; se repetir, avise o suporte.')).toBeInTheDocument();
    expect(within(dialogo()).getByText('Capa · Preto')).toBeInTheDocument();
    expect(screen.queryByText(/codigo_que_nao_existe|Erro:/)).toBeNull();
  });
});

describe('PainelImagens: exibição e cobrança', () => {
  it('listar → imagem válida confirma uma vez, mesmo com polls seguintes (URL estável)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem(), imagem({ id: 'i2', missao: 2, status: 'gerando', url: null })])));
    painel();
    const img = await screen.findByAltText('Capa · Preto');
    fireEvent.load(img);
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith('MLB1', ['i1']));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ url: 'https://signed/outra.png', exibida: true }), imagem({ id: 'i2', missao: 2, status: 'gerando', url: null })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    expect(screen.getByAltText('Capa · Preto')).toHaveAttribute('src', 'https://signed/i1.png');
    fireEvent.load(screen.getByAltText('Capa · Preto'));
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(1);
  });

  it('ampliar abre o diálogo com a imagem e os alertas, sem nova confirmação nem reporte', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ alertas: [{ tipo: 'texto_extra', nota: '"Oferta"' }] })])));
    painel();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Ampliar Capa' }));
    const d = dialogo();
    expect(within(d).getByText('Capa · Preto')).toBeInTheDocument();
    const grande = within(d).getByRole('img');
    expect(grande).toHaveAttribute('src', 'https://signed/i1.png');
    expect(within(d).getByText('Texto a mais na imagem: "Oferta"')).toBeInTheDocument();
    fireEvent.load(grande);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(1);
    expect(api.reportarInvalida).not.toHaveBeenCalled();
  });

  it('imagem branca → reportar_invalida e nenhuma confirmação', async () => {
    valida.fn.mockReturnValue(false);
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    painel();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await waitFor(() => expect(api.reportarInvalida).toHaveBeenCalledWith('MLB1', 'i1'));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
  });

  it('canvas contaminado (exceção na validação) → nem confirma nem reporta', async () => {
    valida.fn.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    painel();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
    expect(api.reportarInvalida).not.toHaveBeenCalled();
  });

  it('já exibida não chama confirmação', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ exibida: true })])));
    painel();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
  });

  it('polling para quando tudo é terminal e os alertas chegaram; para ao desmontar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ status: 'gerando', url: null })])));
    const { unmount } = painel();
    await screen.findByText('Capa');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
  });

  it('sem linha aberta e com alertas → não faz polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ exibida: true }), imagem({ id: 'f', missao: 2, status: 'falhou', alertas: null, url: null })])));
    painel();
    await screen.findByAltText('Capa · Preto');
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(1);
  });

  it('listar com 503 continua o polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValueOnce(falha(503, 'falha_interna')).mockResolvedValue(ok(lista([imagem()])));
    painel();
    expect(await screen.findByText(/Erro interno/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(await screen.findByAltText('Capa · Preto')).toBeInTheDocument();
    expect(api.listarImagens).toHaveBeenCalledTimes(2);
  });

  it('listar com 409 não reagenda e informa a página', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const aoFalha = vi.fn();
    api.listarImagens.mockResolvedValue(falha(409, 'anuncio_ambiguo'));
    render(<PainelImagens mlItemId="MLB1" cor="Preto" aoFalha={aoFalha} />);
    await screen.findByText(/identificar este anúncio/);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.listarImagens).toHaveBeenCalledTimes(1);
    expect(aoFalha).toHaveBeenCalledWith('anuncio_ambiguo');
  });

  it('falha de carga não é terminal: aviso, sem cobrar nem reportar; o poll seguinte tenta com URL nova e cobra', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    painel();
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
    painel();
    fireEvent.load(await screen.findByAltText('Capa · Preto'));
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(2));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ exibida: true })])));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(2);
  });
});

describe('PainelImagens: aprovar', () => {
  it('recorta a imagem (só a capa é encaixada inteira), sobe pela URL assinada e aprova; não compõe texto', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ id: 'c1', missao: 1 }), imagem({ id: 'u2', missao: 2, url: 'https://signed/u2.png' })])));
    painel();
    await userEvent.click(within(await esperaCartao('Em uso')).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalledWith('MLB1', 'u2'));
    expect(final.fn).toHaveBeenCalledWith('https://signed/u2.png', false);
    expect(api.prepararUploadFinal).toHaveBeenCalledWith('MLB1', 'u2');
    expect(api.enviarFinal).toHaveBeenCalledWith('org/galeria-ia/F1/finais/i1-n.jpg', 't', expect.any(Blob));
    await userEvent.click(within(cartao('Capa')).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(final.fn).toHaveBeenCalledWith('https://signed/i1.png', true));
  });

  /** Imagem pronta cujo <img> carregou e passou em `imagemValida` nesta sessão (1ª confirmação já sai aqui). */
  const validadaNaSessao = async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2 })])));
    painel();
    fireEvent.load(await screen.findByAltText('Em uso · Preto'));
    await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledTimes(1));
    // Depois da confirmação o servidor diz `exibida` (senão o polling confirmaria de novo).
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2, exibida: true })])));
  };

  it('exibicao_pendente com a imagem validada → confirma a exibição e repete só o aprovar (sem recortar nem novo upload)', async () => {
    api.aprovarFinal.mockResolvedValueOnce(falha(409, 'exibicao_pendente'));
    await validadaNaSessao();
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalledTimes(2));
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(2);
    expect(api.confirmarExibicao).toHaveBeenLastCalledWith('MLB1', ['i1']);
    expect(final.fn).toHaveBeenCalledTimes(1);
    expect(api.prepararUploadFinal).toHaveBeenCalledTimes(1);
  });

  it('exibicao_pendente de novo após confirmar → motivo no cartão, sem laço', async () => {
    api.aprovarFinal.mockResolvedValue(falha(409, 'exibicao_pendente'));
    await validadaNaSessao();
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/sendo registrada/i)).toBeInTheDocument();
    expect(api.aprovarFinal).toHaveBeenCalledTimes(2);
    expect(api.confirmarExibicao).toHaveBeenCalledTimes(2);
  });

  it('exibicao_pendente com a imagem ainda não validada nesta sessão → não confirma (não cobra) e pede para aguardar', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2, exibida: true })])));
    api.aprovarFinal.mockResolvedValue(falha(409, 'exibicao_pendente'));
    painel();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText('A imagem ainda não terminou de carregar. Aguarde ela aparecer e aprove de novo.')).toBeInTheDocument();
    expect(api.confirmarExibicao).not.toHaveBeenCalled();
    expect(api.aprovarFinal).toHaveBeenCalledTimes(1);
  });

  it('imagem que não cabe no formato: motivo claro no cartão e nada sobe', async () => {
    final.fn.mockRejectedValue(new Error('corte'));
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2 })])));
    painel();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/não cabe no formato do anúncio/)).toBeInTheDocument();
    expect(api.prepararUploadFinal).not.toHaveBeenCalled();
    expect(api.aprovarFinal).not.toHaveBeenCalled();
  });

  it('arquivo recusado pelo servidor: motivo no cartão', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ missao: 2 })])));
    api.aprovarFinal.mockResolvedValueOnce(falha(422, 'arquivo_invalido', { erros: ['branca'] }));
    painel();
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText(/em branco/)).toBeInTheDocument();
  });
});

describe('PainelImagens: aprovar todas', () => {
  const pronta = (n: number, extra: Partial<ImagemGaleria> = {}) =>
    imagem({ id: `g${n}`, missao: n, exibida: true, url: `https://signed/g${n}.png`, ...extra });
  const sete = (extras: Record<number, Partial<ImagemGaleria>> = {}) => [1, 2, 3, 4, 5, 6, 7].map((n) => pronta(n, extras[n]));
  const AVISO = [{ tipo: 'texto_extra' as const, nota: '"Oferta"' }];
  const botaoTodas = (n: number) => screen.findByRole('button', { name: `Aprovar todas (${n})` });
  const idsAprovados = () => api.aprovarFinal.mock.calls.map((c) => c[1]);
  const confirmarAprovacao = () => userEvent.click(within(dialogo()).getByRole('button', { name: 'Aprovar' }));

  it('conta só as aprováveis: com alerta e já aprovada ficam de fora', async () => {
    api.listarImagens.mockResolvedValue(ok(lista(sete({ 2: { alertas: AVISO }, 3: { status: 'aprovada' } }))));
    painel();
    expect(await botaoTodas(5)).toBeEnabled();
  });

  it('não conta imagem ainda não exibida nem de versão anterior', async () => {
    api.listarImagens.mockResolvedValue(ok(lista(sete({ 1: { exibida: false }, 2: { roteiro_id: 'P0' }, 3: { alertas: [{ tipo: 'verificacao_indisponivel', nota: '' }] } }))));
    painel();
    expect(await botaoTodas(4)).toBeInTheDocument();
  });

  it('sem aprováveis não há botão de aprovar todas', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([pronta(1, { exibida: false }), pronta(2, { alertas: AVISO })])));
    painel();
    await screen.findByText('Capa');
    expect(screen.queryByRole('button', { name: /^Aprovar todas/ })).toBeNull();
  });

  it('o diálogo mostra a quantidade e as imagens com aviso; cancelar não aprova', async () => {
    api.listarImagens.mockResolvedValue(ok(lista(sete({ 2: { alertas: AVISO } }))));
    painel();
    await userEvent.click(await botaoTodas(6));
    expect(within(dialogo()).getByText('Aprovar 6 imagens?')).toBeInTheDocument();
    expect(within(dialogo()).getByText('1 com aviso de texto ficam para você conferir uma a uma.')).toBeInTheDocument();
    await userEvent.click(within(dialogo()).getByRole('button', { name: 'Cancelar' }));
    expect(api.aprovarFinal).not.toHaveBeenCalled();
  });

  it('confirmar aprova em sequência (a 2ª só começa depois de a 1ª terminar) e nunca a que tem alerta', async () => {
    let liberar!: (r: Res<unknown>) => void;
    api.aprovarFinal.mockImplementation((_ml: string, id: string) => (id === 'g1' ? new Promise((r) => { liberar = r; }) : Promise.resolve(ok({ status: 'aprovada' }))));
    api.listarImagens.mockResolvedValue(ok(lista(sete({ 2: { alertas: AVISO }, 3: { status: 'aprovada' } }))));
    painel();
    const antes = await botaoTodas(5);
    expect(antes.parentElement!.querySelector('.border-trail__track')).toBeNull();
    await userEvent.click(antes);
    await confirmarAprovacao();
    await waitFor(() => expect(idsAprovados()).toEqual(['g1']));
    const aprovando = await screen.findByRole('button', { name: 'Aprovando 1 de 5…' });
    expect(aprovando).toBeDisabled();
    // Neon girando em volta do botão só enquanto a fila roda.
    expect(aprovando.parentElement!.querySelector('.border-trail__track')).not.toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(idsAprovados()).toEqual(['g1']);
    await act(async () => { liberar(ok({ status: 'aprovada' })); });
    await waitFor(() => expect(idsAprovados()).toEqual(['g1', 'g4', 'g5', 'g6', 'g7']));
    expect(idsAprovados()).not.toContain('g2');
    await waitFor(() => expect(document.querySelector('.border-trail__track')).toBeNull());
    const { toast } = await import('sonner');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('5 imagens aprovadas'));
  });

  it('"Todas as cores": aprova as aprováveis das duas cores', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([
      pronta(1), pronta(2, { alertas: AVISO }),
      pronta(1, { id: 'r1', cor: 'Rosa' }), pronta(2, { id: 'r2', cor: 'Rosa' }),
    ], { cores: ['Preto', 'Rosa'] })));
    painel(null);
    await userEvent.click(await botaoTodas(3));
    await confirmarAprovacao();
    await waitFor(() => expect(idsAprovados()).toEqual(['g1', 'r1', 'r2']));
  });

  it('falha na 2ª de 3: as outras são aprovadas, o aviso lista a que falhou e o toast conta 2', async () => {
    api.aprovarFinal.mockImplementation((_ml: string, id: string) =>
      Promise.resolve(id === 'g2' ? falha(422, 'arquivo_invalido', { erros: ['branca'] }) : ok({ status: 'aprovada' })));
    api.listarImagens.mockResolvedValue(ok(lista([pronta(1), pronta(2), pronta(3)])));
    painel();
    await userEvent.click(await botaoTodas(3));
    await confirmarAprovacao();
    expect(await screen.findByText(/Não foi possível aprovar: Em uso \(Preto\): .*em branco/)).toBeInTheDocument();
    expect(idsAprovados()).toEqual(['g1', 'g2', 'g3']);
    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalledWith('2 imagens aprovadas');
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText(/Não foi possível aprovar/)).toBeNull();
  });

  it('durante o processo, Gerar e Aprovar individuais ficam desabilitados', async () => {
    let liberar!: (r: Res<unknown>) => void;
    api.aprovarFinal.mockImplementation(() => new Promise((r) => { liberar = r; }));
    api.listarImagens.mockResolvedValue(ok(lista([pronta(1), pronta(2)])));
    painel();
    await userEvent.click(await botaoTodas(2));
    await confirmarAprovacao();
    await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalled());
    const botoes = screen.getAllByRole('button', { name: /^(Gerar( |$)|Aprovar$)/, hidden: true });
    expect(botoes.length).toBeGreaterThan(5);
    botoes.forEach((b) => expect(b).toBeDisabled());
    api.aprovarFinal.mockResolvedValue(ok({ status: 'aprovada' }));
    await act(async () => { liberar(ok({ status: 'aprovada' })); });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Aprovando/ })).toBeNull());
  });
});

describe('CartaoImagem', () => {
  const base = { nome: 'Capa', cor: 'Preto', preco: 'R$ 0,50' };
  it.each([
    [{ status: 'gerando', url: null }, 'gerando'], [{ alertas: null }, 'gerando'], [{}, 'pronta'], [{ status: 'aprovada' }, 'aprovada'],
    [{ status: 'falhou', url: null }, 'falhou'],
  ] as const)('%j → estado %s', (extra, estado) => {
    render(<CartaoImagem {...base} imagem={imagem(extra as Partial<ImagemGaleria>)} />);
    expect(document.querySelector('[data-estado]')).toHaveAttribute('data-estado', estado);
  });
  it('imagem que não carregou não tem botão Aprovar', () => {
    render(<CartaoImagem {...base} imagem={imagem({ missao: 2, exibida: true })} onAprovar={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    fireEvent.error(screen.getByAltText('Capa · Preto'));
    expect(screen.getByText(/Não foi possível exibir a imagem/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
  });
  it('sem imagem: vazio com o preço no botão; com motivo: indisponível', () => {
    const { unmount } = render(<CartaoImagem {...base} onGerar={vi.fn()} />);
    expect(screen.getByRole('button', { name: GERAR })).toBeInTheDocument();
    unmount();
    render(<CartaoImagem {...base} indisponivel="Sem dados." onGerar={vi.fn()} />);
    expect(screen.getByText('Sem dados.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
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
