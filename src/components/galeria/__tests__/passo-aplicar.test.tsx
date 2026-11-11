import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { escolherNoSelect } from '@/test/select';
import { PassoAplicar } from '../passo-aplicar';
import type { EstadoAplicacao, Ficha, Res } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({
  prepararAplicacao: vi.fn(), confirmarAplicacao: vi.fn(), reverterAplicacao: vi.fn(), estadoAplicacoes: vi.fn(),
}));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (status: number, erro: string, corpo: Record<string, unknown> = {}): Res<never> => ({ ok: false, status, erro, corpo });
const ficha = { anuncio_externo_id: 'A1', familia_id: 'F1', codigo_pai: '0001', cores: ['Rosa', 'Azul'], fatos: [], fatos_hash: 'h',
  roteiro_desatualizado: false, referencias: {} } as Ficha;
const manifesto = [1, 2, 3].map((m) => ({ imagem_id: `g${m}`, missao: m, final_sha256: `s${m}` }));
const preparada = { aplicacao_id: 'APL1', status: 'preparada' as const, itens: ['MLB3P', 'MLB3M'], manifesto };
const aplicacao = (extra: Partial<EstadoAplicacao> = {}): EstadoAplicacao => ({
  id: 'APL1', cor: 'Rosa', modo: 'substituir', status: 'aplicada', manifesto,
  itens: [{ item_id: 'MLB3P', status: 'aplicado', erro: null }], ...extra,
});

function montar(isAdmin = true, mlItemId = 'MLB3M') {
  const aoFamiliaMudou = vi.fn();
  const r = render(<PassoAplicar mlItemId={mlItemId} ficha={ficha} isAdmin={isAdmin} aoFamiliaMudou={aoFamiliaMudou} />);
  return { ...r, aoFamiliaMudou };
}
const preparar = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Preparar' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [] }));
  api.prepararAplicacao.mockResolvedValue(ok(preparada));
});
afterEach(() => { vi.useRealTimers(); });

describe('PassoAplicar — admin (ADR-0060)', () => {
  it('não admin: Preparar e Reverter desabilitados com title e nenhuma chamada de escrita', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao()] }));
    montar(false);
    const prep = await screen.findByRole('button', { name: 'Preparar' });
    const rev = await screen.findByRole('button', { name: 'Reverter' });
    for (const b of [prep, rev]) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', expect.stringMatching(/administrador/i));
    }
    expect(api.prepararAplicacao).not.toHaveBeenCalled();
  });
});

describe('PassoAplicar — preparar e confirmar', () => {
  it('Substituir já vem selecionado; preparar manda o ml_item_id da linha, a cor e o modo', async () => {
    montar(true, 'MLB3M');
    expect(await screen.findByRole('combobox', { name: 'Modo' })).toHaveTextContent('Substituir');
    await preparar();
    expect(api.prepararAplicacao).toHaveBeenCalledWith('MLB3M', 'Rosa', 'substituir');
  });

  it('a confirmação lista os MLB e as imagens do manifesto na ordem, avisa que troca as fotos e só então confirma', async () => {
    api.confirmarAplicacao.mockResolvedValue(ok({ status: 'em_andamento' }));
    montar(true, 'MLB3M');
    await preparar();
    const itens = within(await screen.findByRole('list', { name: 'Anúncios afetados' })).getAllByRole('listitem');
    expect(itens.map((i) => i.textContent)).toEqual(['MLB3P', 'MLB3M']);
    const imgs = within(screen.getByRole('list', { name: 'Imagens na ordem' })).getAllByRole('listitem');
    expect(imgs.map((i) => i.textContent)).toEqual([expect.stringContaining('Missão 1'), expect.stringContaining('Missão 2'), expect.stringContaining('Missão 3')]);
    expect(screen.getByText(/troca as fotos/i)).toBeInTheDocument();
    expect(api.confirmarAplicacao).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Confirmar e trocar/ }));
    expect(api.confirmarAplicacao).toHaveBeenCalledWith('MLB3M', 'APL1');
    await waitFor(() => expect(api.estadoAplicacoes.mock.calls.length).toBeGreaterThan(1));
  });

  it('limite no modo Adicionar: volta para Substituir e explica', async () => {
    api.prepararAplicacao.mockResolvedValueOnce(falha(409, 'limite', { detalhe: 'MLB3M:100R:15>12' }));
    montar();
    await screen.findByRole('combobox', { name: 'Modo' });
    await escolherNoSelect(userEvent.setup(), 'Modo', 'Adicionar');
    expect(screen.getByRole('combobox', { name: 'Modo' })).toHaveTextContent('Adicionar');
    await preparar();
    expect(await screen.findByRole('alert')).toHaveTextContent(/limite.*Substituir/i);
    expect(screen.getByRole('combobox', { name: 'Modo' })).toHaveTextContent('Substituir');
  });

  it.each([['mudou', /Prepare de novo/i], ['desatualizada', /Prepare de novo/i]])('%s: pede nova preparação e descarta a confirmação', async (erro, texto) => {
    api.confirmarAplicacao.mockResolvedValue(falha(409, erro));
    montar();
    await preparar();
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar e trocar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(texto);
    expect(screen.queryByRole('list', { name: 'Anúncios afetados' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar' })).toBeEnabled();
  });

  it('familia_nao_vigente recarrega a galeria', async () => {
    api.prepararAplicacao.mockResolvedValue(falha(409, 'familia_nao_vigente', { familia_id_vigente: 'F2' }));
    const { aoFamiliaMudou } = montar();
    await preparar();
    await waitFor(() => expect(aoFamiliaMudou).toHaveBeenCalledWith(expect.stringMatching(/família.*mudou.*F2/i)));
  });

  it('recusa com detalhe mostra o MLB', async () => {
    api.prepararAplicacao.mockResolvedValue(falha(409, 'variacao_nao_casa', { item_id: 'MLB3G' }));
    montar();
    await preparar();
    expect(await screen.findByRole('alert')).toHaveTextContent('MLB3G');
  });
});

describe('PassoAplicar — fix round 1', () => {
  it('Cor/Modo travados com Preparar em voo; confirmação mostra a cor e o modo do clique', async () => {
    let resolver!: (r: Res<typeof preparada>) => void;
    api.prepararAplicacao.mockReturnValueOnce(new Promise((r) => { resolver = r; }));
    montar();
    await screen.findByRole('combobox', { name: 'Modo' });
    await escolherNoSelect(userEvent.setup(), 'Modo', 'Adicionar');
    await preparar();
    expect(api.prepararAplicacao).toHaveBeenCalledWith('MLB3M', 'Rosa', 'adicionar');
    expect(screen.getByRole('combobox', { name: 'Cor' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Modo' })).toBeDisabled();
    resolver(ok(preparada));
    const painel = (await screen.findByRole('list', { name: 'Anúncios afetados' })).parentElement!;
    expect(painel).toHaveTextContent('Rosa');
    expect(painel).toHaveTextContent(/Adicionar/);
    expect(painel).not.toHaveTextContent(/substituem/);
    expect(screen.getByRole('combobox', { name: 'Cor' })).toBeEnabled();
  });

  it('trocar Cor/Modo com a confirmação aberta a descarta; a confirmar usa a aplicação preparada', async () => {
    montar();
    await preparar();
    await screen.findByRole('list', { name: 'Anúncios afetados' });
    await escolherNoSelect(userEvent.setup(), 'Cor', 'Azul');
    expect(screen.queryByRole('list', { name: 'Anúncios afetados' })).not.toBeInTheDocument();
  });

  it.each([[401], [409], [503], [0]])('estado com falha %s reagenda; 3 falhas seguidas avisam sem apagar o último status', async (status) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const vermelha = aplicacao({ status: 'revertendo', itens: [{ item_id: 'MLB3P', status: 'reversao_incompleta', erro: null }] });
    api.estadoAplicacoes.mockResolvedValueOnce(ok({ aplicacoes: [vermelha] })).mockResolvedValue(falha(status, status === 0 ? 'rede' : 'x'));
    montar();
    await screen.findByText(/MLB3P/);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await screen.findByRole('alert')).toHaveTextContent(/andamento/i);
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(4);
    expect(screen.getByText(/MLB3P/).closest('li')!.className).toMatch(/red/);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(5);
  });

  it('o aviso some quando a leitura volta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.estadoAplicacoes.mockResolvedValueOnce(ok({ aplicacoes: [aplicacao({ status: 'em_andamento' })] }))
      .mockResolvedValueOnce(falha(0, 'rede')).mockResolvedValueOnce(falha(0, 'rede')).mockResolvedValueOnce(falha(0, 'rede'))
      .mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'aplicada' })] }));
    montar();
    await screen.findByText(/Aplicando/);
    await vi.advanceTimersByTimeAsync(15000);
    await screen.findByRole('alert');
    await vi.advanceTimersByTimeAsync(5000);
    await screen.findByRole('button', { name: 'Reverter' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem_conexao_ml no Preparar fala de aplicar fotos', async () => {
    api.prepararAplicacao.mockResolvedValue(falha(409, 'sem_conexao_ml'));
    montar();
    await preparar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Conecte a conta do Mercado Livre antes de aplicar as fotos');
  });
});

describe('PassoAplicar — acompanhamento e reversão', () => {
  it('reversao_incompleta e pulado aparecem em vermelho com os MLB', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'reversao_incompleta', itens: [
      { item_id: 'MLB3P', status: 'reversao_incompleta', erro: 'fotos divergentes' }, { item_id: 'MLB3G', status: 'pulado', erro: null },
      { item_id: 'MLB3M', status: 'compensado', erro: null }] })] }));
    montar();
    for (const mlb of ['MLB3P', 'MLB3G']) {
      const li = (await screen.findByText(new RegExp(mlb))).closest('li')!;
      expect(li.className).toMatch(/red/);
    }
    expect(screen.getByText(/MLB3M/).closest('li')!.className).not.toMatch(/red/);
    expect(screen.queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
  });

  it('aplicada oferece Reverter, que manda o ml_item_id da linha e a aplicação', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao()] }));
    api.reverterAplicacao.mockResolvedValue(ok({ status: 'revertendo' }));
    montar(true, 'MLB3M');
    await userEvent.click(await screen.findByRole('button', { name: 'Reverter' }));
    expect(api.reverterAplicacao).not.toHaveBeenCalled();
    expect(within(screen.getByRole('list', { name: 'Anúncios afetados' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['MLB3P']);
    expect(screen.getByText(/volta as fotos anteriores/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Confirmar reversão/ }));
    expect(api.reverterAplicacao).toHaveBeenCalledWith('MLB3M', 'APL1');
  });

  it('reverter recusado (item_ocupado) mostra a mensagem em português', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao()] }));
    api.reverterAplicacao.mockResolvedValue(falha(409, 'item_ocupado'));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Reverter' }));
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar reversão/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Outra operação/);
  });

  it('polling de 5 s enquanto em andamento; para quando termina e ao desmontar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.estadoAplicacoes.mockResolvedValueOnce(ok({ aplicacoes: [aplicacao({ status: 'em_andamento' })] }))
      .mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'aplicada' })] }));
    const { unmount } = montar();
    await screen.findByText(/Aplicando/);
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    await screen.findByRole('button', { name: 'Reverter' });
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('desmontar cancela o polling pendente', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'revertendo' })] }));
    const { unmount } = montar();
    await screen.findByText(/Revertendo/);
    unmount();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(1);
  });
});
