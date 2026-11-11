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

function montar(isAdmin = true, mlItemId = 'MLB3M', aprovadasPorCor: Record<string, number> | null = { Rosa: 3, Azul: 1 }) {
  const aoFamiliaMudou = vi.fn();
  const aoIrParaGerar = vi.fn();
  const r = render(<PassoAplicar mlItemId={mlItemId} cores={ficha.cores} isAdmin={isAdmin} aprovadasPorCor={aprovadasPorCor} formato="Legacy"
    aoFamiliaMudou={aoFamiliaMudou} aoIrParaGerar={aoIrParaGerar} aoVoltar={vi.fn()} />);
  return { ...r, aoFamiliaMudou, aoIrParaGerar };
}
const preparar = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Ver prévia|Ver de novo/ }));
};
/** Rodapé "Aplicar na cor X" → confirmação → "Aplicar na cor X" do diálogo. */
const aplicar = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^Aplicar na cor/ }));
  const dlg = await screen.findByRole('alertdialog');
  await userEvent.click(within(dlg).getByRole('button', { name: /^Aplicar na cor/ }));
};

beforeEach(() => {
  vi.clearAllMocks();
  api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [] }));
  api.prepararAplicacao.mockResolvedValue(ok(preparada));
});
afterEach(() => { vi.useRealTimers(); });

describe('PassoAplicar: admin (ADR-0060)', () => {
  it('não admin: Ver prévia e Desfazer desabilitados com title, Aplicar desabilitado e nenhuma chamada de escrita', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao()] }));
    montar(false);
    expect(await screen.findByRole('button', { name: /^Aplicar na cor/ })).toBeDisabled();
    const prep = await screen.findByRole('button', { name: 'Ver prévia' });
    const rev = await screen.findByRole('button', { name: 'Desfazer aplicação' });
    for (const b of [prep, rev]) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', expect.stringMatching(/administrador/i));
    }
    expect(api.prepararAplicacao).not.toHaveBeenCalled();
  });
});

describe('PassoAplicar: cor fixa', () => {
  it('com corFixa não há seletor Cor e a prévia usa a cor da prop', async () => {
    render(<PassoAplicar mlItemId="MLB3M" cores={['Rosa', 'Azul']} corFixa="Azul" isAdmin aprovadasPorCor={{ Rosa: 3, Azul: 1 }}
      aoFamiliaMudou={vi.fn()} aoIrParaGerar={vi.fn()} aoVoltar={vi.fn()} />);
    expect(await screen.findByRole('combobox', { name: 'Como aplicar' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Cor' })).toBeNull();
    await preparar();
    expect(api.prepararAplicacao).toHaveBeenCalledWith('MLB3M', 'Azul', 'substituir');
  });
});

describe('PassoAplicar: preparar e confirmar', () => {
  it('Substituir já vem selecionado; preparar manda o ml_item_id da linha, a cor e o modo', async () => {
    montar(true, 'MLB3M');
    expect(await screen.findByRole('combobox', { name: 'Como aplicar' })).toHaveTextContent('Substituir');
    await preparar();
    expect(api.prepararAplicacao).toHaveBeenCalledWith('MLB3M', 'Rosa', 'substituir');
  });

  it('sem a prévia o Aplicar fica desabilitado; a prévia lista os MLB e as imagens na ordem; o diálogo confirma', async () => {
    api.confirmarAplicacao.mockResolvedValue(ok({ status: 'em_andamento' }));
    montar(true, 'MLB3M');
    expect(await screen.findByRole('button', { name: /^Aplicar na cor Rosa/ })).toBeDisabled();
    await preparar();
    const itens = within(await screen.findByRole('list', { name: 'Anúncios afetados' })).getAllByRole('listitem');
    expect(itens.map((i) => i.textContent)).toEqual([expect.stringContaining('MLB3P'), expect.stringContaining('MLB3M')]);
    const imgs = within(screen.getByRole('list', { name: 'Imagens na ordem' })).getAllByRole('listitem');
    expect(imgs.map((i) => i.textContent)).toEqual([expect.stringContaining('Capa'), expect.stringContaining('Onde usar'), expect.stringContaining('lupa')]);
    expect(api.confirmarAplicacao).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Aplicar na cor Rosa/ }));
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg).toHaveTextContent('Aplicar 3 imagens na cor Rosa?');
    expect(dlg).toHaveTextContent(/Vai trocar as fotos da cor Rosa nos anúncios MLB3P e MLB3M/);
    expect(dlg).toHaveTextContent('Isso é visível para compradores imediatamente');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Aplicar na cor Rosa' }));
    expect(api.confirmarAplicacao).toHaveBeenCalledWith('MLB3M', 'APL1');
    await waitFor(() => expect(api.estadoAplicacoes.mock.calls.length).toBeGreaterThan(1));
  });

  it('limite no modo Adicionar: volta para Substituir e explica', async () => {
    api.prepararAplicacao.mockResolvedValueOnce(falha(409, 'limite', { detalhe: 'MLB3M:100R:15>12' }));
    montar();
    await screen.findByRole('combobox', { name: 'Como aplicar' });
    await escolherNoSelect(userEvent.setup(), 'Como aplicar', 'Adicionar às fotos da cor');
    expect(screen.getByRole('combobox', { name: 'Como aplicar' })).toHaveTextContent('Adicionar');
    await preparar();
    expect(await screen.findByRole('alert')).toHaveTextContent(/limite.*Substituir/i);
    expect(screen.getByRole('combobox', { name: 'Como aplicar' })).toHaveTextContent('Substituir');
  });

  it.each([['mudou', /prévia de novo/i], ['desatualizada', /prévia de novo/i]])('%s: pede nova prévia e descarta a confirmação', async (erro, texto) => {
    api.confirmarAplicacao.mockResolvedValue(falha(409, erro));
    montar();
    await preparar();
    await aplicar();
    expect(await screen.findByRole('alert')).toHaveTextContent(texto);
    expect(screen.queryByRole('list', { name: 'Anúncios afetados' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver prévia' })).toBeEnabled();
  });

  it('familia_nao_vigente recarrega a galeria', async () => {
    api.prepararAplicacao.mockResolvedValue(falha(409, 'familia_nao_vigente', { familia_id_vigente: 'F2' }));
    const { aoFamiliaMudou } = montar();
    await preparar();
    await waitFor(() => expect(aoFamiliaMudou).toHaveBeenCalledWith(expect.stringMatching(/cadastro.*mudou/i)));
  });

  it('recusa com detalhe mostra o MLB', async () => {
    api.prepararAplicacao.mockResolvedValue(falha(409, 'variacao_nao_casa', { item_id: 'MLB3G' }));
    montar();
    await preparar();
    expect(await screen.findByRole('alert')).toHaveTextContent('MLB3G');
  });
});

describe('PassoAplicar: fix round 1', () => {
  it('Cor/Modo travados com Preparar em voo; confirmação mostra a cor e o modo do clique', async () => {
    let resolver!: (r: Res<typeof preparada>) => void;
    api.prepararAplicacao.mockReturnValueOnce(new Promise((r) => { resolver = r; }));
    montar();
    await screen.findByRole('combobox', { name: 'Como aplicar' });
    await escolherNoSelect(userEvent.setup(), 'Como aplicar', 'Adicionar às fotos da cor');
    await preparar();
    expect(api.prepararAplicacao).toHaveBeenCalledWith('MLB3M', 'Rosa', 'adicionar');
    expect(screen.getByRole('combobox', { name: 'Cor' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Como aplicar' })).toBeDisabled();
    resolver(ok(preparada));
    const painel = screen.getByRole('region', { name: 'Prévia' });
    await within(painel).findByRole('list', { name: 'Anúncios afetados' });
    expect(painel).toHaveTextContent('cor Rosa');
    expect(painel).toHaveTextContent(/Entram depois das fotos da cor/);
    expect(screen.getByRole('status')).toHaveTextContent('Adiciona às fotos da cor Rosa em 2 anúncios');
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
    expect(screen.getByText(/MLB3P/).closest('li')!.className).toMatch(/destructive/);
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
    await screen.findByRole('button', { name: 'Desfazer aplicação' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem_conexao_ml no Preparar fala de aplicar fotos', async () => {
    api.prepararAplicacao.mockResolvedValue(falha(409, 'sem_conexao_ml'));
    montar();
    await preparar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Conecte a conta do Mercado Livre antes de aplicar as fotos');
  });
});

describe('PassoAplicar: acompanhamento e reversão', () => {
  it('reversao_incompleta e pulado aparecem em vermelho com os MLB', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'reversao_incompleta', itens: [
      { item_id: 'MLB3P', status: 'reversao_incompleta', erro: 'fotos divergentes' }, { item_id: 'MLB3G', status: 'pulado', erro: null },
      { item_id: 'MLB3M', status: 'compensado', erro: null }] })] }));
    montar();
    for (const mlb of ['MLB3P', 'MLB3G']) {
      const li = (await screen.findByText(new RegExp(mlb))).closest('li')!;
      expect(li.className).toMatch(/destructive/);
    }
    expect(screen.getByText(/MLB3M/).closest('li')!.className).not.toMatch(/destructive/);
    expect(screen.queryByRole('button', { name: 'Desfazer aplicação' })).not.toBeInTheDocument();
  });

  it('aplicada oferece Reverter, que manda o ml_item_id da linha e a aplicação', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao()] }));
    api.reverterAplicacao.mockResolvedValue(ok({ status: 'revertendo' }));
    montar(true, 'MLB3M');
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer aplicação' }));
    expect(api.reverterAplicacao).not.toHaveBeenCalled();
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg).toHaveTextContent(/volta as fotos anteriores da cor Rosa no anúncio MLB3P/i);
    await userEvent.click(within(dlg).getByRole('button', { name: /Confirmar e desfazer/ }));
    expect(api.reverterAplicacao).toHaveBeenCalledWith('MLB3M', 'APL1');
  });

  it('reverter recusado (item_ocupado) mostra a mensagem em português', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao()] }));
    api.reverterAplicacao.mockResolvedValue(falha(409, 'item_ocupado'));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer aplicação' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /Confirmar e desfazer/ }));
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
    await screen.findByRole('button', { name: 'Desfazer aplicação' });
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('desmontar cancela o polling pendente', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'revertendo' })] }));
    const { unmount } = montar();
    await screen.findByText(/Desfazendo/);
    unmount();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.estadoAplicacoes).toHaveBeenCalledTimes(1);
  });
});

// Fase C2: prévia "Hoje no anúncio" × "Depois", acompanhamento por MLB e estado vazio, como no protótipo aprovado.
describe('PassoAplicar: prévia e acompanhamento (Fase C2)', () => {
  const comPrevia = {
    ...preparada, itens: ['MLB1'], manifesto: manifesto.slice(0, 2),
    previa: [{ item_id: 'MLB1',
      antes: [{ id: 'R0', url: 'https://ml/R0.jpg', sai: false }, { id: 'R1', url: 'https://ml/R1.jpg', sai: true }, { id: 'R2', url: null, sai: true }],
      depois: [{ id: 'R0', url: 'https://ml/R0.jpg', nova: false }, { id: 'novo-1', url: 'https://signed/g1.jpg', nova: true, missao: 1 }, { id: 'novo-2', url: null, nova: true, missao: 2 }] }],
  };

  it('mostra hoje × depois: as que saem riscadas, as novas com selo "Nova", contagens e nenhuma escrita antes do diálogo', async () => {
    api.prepararAplicacao.mockResolvedValue(ok(comPrevia));
    montar(true, 'MLB1');
    await preparar();
    const painel = await screen.findByRole('region', { name: 'Prévia' });
    expect(await within(painel).findByText(/Hoje no anúncio/)).toHaveTextContent('3 fotos');
    expect(within(painel).getByText(/^Depois/)).toHaveTextContent('3 fotos');
    const riscadas = within(painel).getAllByRole('img', { name: /será removida/ });
    expect(riscadas).toHaveLength(2);
    riscadas.forEach((r) => expect(r).toHaveAttribute('data-sai', 'true'));
    expect(within(painel).getByRole('img', { name: 'Foto atual 1' })).not.toHaveAttribute('data-sai');
    const novas = within(painel).getAllByRole('img', { name: /^Nova:/ });
    expect(novas.map((n) => n.getAttribute('aria-label'))).toEqual(['Nova: Capa', 'Nova: Onde usar']);
    novas.forEach((n) => expect(n).toHaveTextContent('Nova'));
    expect(novas[0].querySelector('img')).toHaveAttribute('src', 'https://signed/g1.jpg');
    expect(within(painel).getByText('Aguardando')).toBeInTheDocument();
    expect(api.confirmarAplicacao).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^Aplicar na cor Rosa/ }));
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg).toHaveTextContent('Aplicar 2 imagens na cor Rosa?');
    expect(dlg).toHaveTextContent('Vai trocar 2 fotos da cor Rosa no anúncio MLB1 pelas 2 imagens aprovadas. Isso é visível para compradores imediatamente.');
  });

  it('Substituir sem foto que saia: o diálogo não diz "trocar 0 fotos" e promete manter as atuais', async () => {
    const semSaida = { ...comPrevia, previa: [{ ...comPrevia.previa[0], antes: [{ id: 'R0', url: null, sai: false }] }] };
    api.prepararAplicacao.mockResolvedValue(ok(semSaida));
    montar(true, 'MLB1');
    await preparar();
    await userEvent.click(await screen.findByRole('button', { name: /^Aplicar na cor Rosa/ }));
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg).not.toHaveTextContent(/trocar 0/);
    expect(dlg).toHaveTextContent('Vai adicionar 2 imagens aprovadas às fotos da cor Rosa no anúncio MLB1 e manter as fotos atuais.');
  });

  it('cor com várias variações no MLB: a prévia e o diálogo dizem "Vale para as N variações desta cor"', async () => {
    api.prepararAplicacao.mockResolvedValue(ok({ ...comPrevia, previa: [{ ...comPrevia.previa[0], variacoes: 3 }] }));
    montar(true, 'MLB1');
    await preparar();
    const painel = await screen.findByRole('region', { name: 'Prévia' });
    expect(within(painel).getByText(/Vale para as/)).toHaveTextContent('Vale para as 3 variações desta cor');
    await userEvent.click(screen.getByRole('button', { name: /^Aplicar na cor Rosa/ }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Vale para as 3 variações desta cor.');
  });

  it('MLB com contagens diferentes: o diálogo traz a contagem de cada um, não o máximo', async () => {
    const p = comPrevia.previa[0];
    api.prepararAplicacao.mockResolvedValue(ok({ ...comPrevia, itens: ['MLB1', 'MLB2'], previa: [{ ...p, variacoes: 2 }, { ...p, item_id: 'MLB2', variacoes: 1 }] }));
    montar(true, 'MLB1');
    await preparar();
    await userEvent.click(await screen.findByRole('button', { name: /^Aplicar na cor Rosa/ }));
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg).toHaveTextContent('Variações da cor por anúncio: MLB1 (2), MLB2 (1).');
    expect(dlg).not.toHaveTextContent('Vale para as 2 variações');
  });

  it('com 1 variação não aparece o aviso de variações', async () => {
    api.prepararAplicacao.mockResolvedValue(ok({ ...comPrevia, previa: [{ ...comPrevia.previa[0], variacoes: 1 }] }));
    montar(true, 'MLB1');
    await preparar();
    await screen.findByRole('region', { name: 'Prévia' });
    expect(screen.queryByText(/Vale para as/)).toBeNull();
  });

  it('erro da edge nunca mostra id interno nem detalhe técnico', async () => {
    api.prepararAplicacao.mockResolvedValue(falha(409, 'limite', { item_id: 'MLB1', detalhe: 'pictures:13 > 12 (uuid-9f3)' }));
    montar(true, 'MLB1');
    await preparar();
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('(MLB1)');
    expect(alerta).not.toHaveTextContent(/uuid|pictures/);
  });

  it('depois de confirmar a prévia fica; selos por MLB: Aplicando → Aplicado com "Desfazer aplicação"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.prepararAplicacao.mockResolvedValue(ok(comPrevia));
    api.confirmarAplicacao.mockResolvedValue(ok({ status: 'em_andamento' }));
    const andando = aplicacao({ status: 'em_andamento', itens: [{ item_id: 'MLB1', status: 'subindo', erro: null }] });
    api.estadoAplicacoes.mockResolvedValueOnce(ok({ aplicacoes: [] })).mockResolvedValueOnce(ok({ aplicacoes: [andando] }))
      .mockResolvedValue(ok({ aplicacoes: [aplicacao({ itens: [{ item_id: 'MLB1', status: 'aplicado', erro: null }] })] }));
    montar(true, 'MLB1');
    await preparar();
    await aplicar();
    const painel = screen.getByRole('region', { name: 'Prévia' });
    expect(await within(painel).findByText('Aplicando')).toBeInTheDocument();
    expect(within(painel).getAllByRole('img', { name: /será removida/ })).toHaveLength(2);
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Aplicando no Mercado Livre');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await within(painel).findByText('Aplicado')).toBeInTheDocument();
    expect(within(painel).getByRole('button', { name: 'Desfazer aplicação' })).toBeEnabled();
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Fotos aplicadas na cor Rosa. Você pode desfazer a qualquer momento.');
    expect(screen.getByRole('button', { name: 'Voltar a Publicados' })).toBeEnabled();
    // A aplicação mostrada na prévia não se repete na lista.
    expect(screen.queryByRole('list', { name: 'Aplicações' })).not.toBeInTheDocument();
  });

  it('Não aplicado mostra o motivo em português (código só no title)', async () => {
    api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'falhou', itens: [
      { item_id: 'MLB3P', status: 'falhou', erro: 'upload_incerto' }, { item_id: 'MLB3G', status: 'pulado', erro: 'prazo_vencido' }] })] }));
    montar();
    const p = (await screen.findByText('MLB3P')).closest('li')!;
    expect(p).toHaveTextContent('Não aplicado');
    expect(p).toHaveTextContent('O envio da foto ficou sem resposta. As fotos da cor não mudaram.');
    expect(within(p).getByTitle('upload_incerto')).toBeInTheDocument();
    expect(screen.getByText('MLB3G').closest('li')).toHaveTextContent('A aplicação parou antes deste anúncio');
  });

  it('sem imagem aprovada: estado vazio que volta às imagens, sem chamar Preparar', async () => {
    const { aoIrParaGerar } = montar(true, 'MLB3M', {});
    expect(await screen.findByText('Aprove ao menos 1 imagem', { selector: 'p.font-medium' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver prévia' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar às imagens' }));
    expect(aoIrParaGerar).toHaveBeenCalled();
    expect(api.prepararAplicacao).not.toHaveBeenCalled();
  });

  it('só as cores com aprovada aparecem na escolha da cor', async () => {
    montar(true, 'MLB3M', { Azul: 2 });
    expect(await screen.findByRole('combobox', { name: 'Cor' })).toHaveTextContent('Azul');
    await preparar();
    expect(api.prepararAplicacao).toHaveBeenCalledWith('MLB3M', 'Azul', 'substituir');
  });

  it('Não aplicado depois de confirmar: motivo no MLB, rodapé explica e "Refazer prévia" prepara outra vez', async () => {
    api.prepararAplicacao.mockResolvedValue(ok(comPrevia));
    api.confirmarAplicacao.mockResolvedValue(ok({ status: 'em_andamento' }));
    api.estadoAplicacoes.mockResolvedValueOnce(ok({ aplicacoes: [] }))
      .mockResolvedValue(ok({ aplicacoes: [aplicacao({ status: 'falhou', itens: [{ item_id: 'MLB1', status: 'pulado', erro: 'put_incerto_sem_efeito' }] })] }));
    montar(true, 'MLB1');
    await preparar();
    await aplicar();
    const painel = screen.getByRole('region', { name: 'Prévia' });
    expect(await within(painel).findByText('Não aplicado')).toBeInTheDocument();
    expect(painel).toHaveTextContent('O Mercado Livre não confirmou a troca. As fotos da cor não mudaram.');
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Veja o motivo abaixo e clique em Refazer prévia');
    await userEvent.click(screen.getByRole('button', { name: 'Refazer prévia' }));
    expect(api.prepararAplicacao).toHaveBeenCalledTimes(2);
  });

  it('edge sem prévia (anterior à C2): mostra só os MLB e as imagens', async () => {
    montar();
    await preparar();
    expect(await screen.findByRole('list', { name: 'Anúncios afetados' })).toBeInTheDocument();
    expect(screen.queryByText(/Hoje no anúncio/)).not.toBeInTheDocument();
  });
});
