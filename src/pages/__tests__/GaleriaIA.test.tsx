// ADR-0203: Galeria IA em tela única, página própria. Guarda do módulo, abertura direta (sem fatos nem roteiro), seletor de
// cor, seção "Colocar no anúncio" e identidade por `ml_item_id`. A grade, a geração e a cobrança têm testes próprios em
// `components/galeria/__tests__/painel-imagens.test.tsx`.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { escolherNoSelect } from '@/test/select';
import GaleriaIA from '../GaleriaIA';
import { BotaoGaleria } from '@/components/galeria/botao-galeria';
import { guardarRetorno, lerRetorno } from '@/lib/galeria/retorno';
import type { ImagemGaleria, RespostaListar, Res } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({
  montarFicha: vi.fn(), lerRoteiro: vi.fn(), listarImagens: vi.fn(), gerarImagens: vi.fn(), confirmarExibicao: vi.fn(),
  reportarInvalida: vi.fn(), prepararUploadFinal: vi.fn(), enviarFinal: vi.fn(), aprovarFinal: vi.fn(),
  estadoAplicacoes: vi.fn(), prepararAplicacao: vi.fn(),
}));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));
vi.mock('@/lib/galeria/final', () => ({ montarArquivoFinal: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })) }));
vi.mock('@/lib/galeria/exibicao', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/exibicao')>()), imagemValida: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const ctx = vi.hoisted(() => ({ modulos: ['imagem_ia'] as string[] | undefined, admin: true }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ctx.modulos }) }));
vi.mock('@/hooks/useOperacoes', () => ({ usePodeExecutarOperacao: () => ctx.admin }));
vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => ({ data: [{ mlItemId: 'MLB1', titulo: 'FITAS VELUDO 16MM 25M', precoPublicacao: 28.4, codigoPai: '0001', userProducts: false }] }),
}));

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (status: number, erro: string, corpo: Record<string, unknown> = {}): Res<never> => ({ ok: false, status, erro, corpo });

const NOMES = ['Capa', 'Em uso', 'Tira-dúvida', 'Benefícios', 'Ficha técnica', 'Como usar', 'Detalhes'];
const imagem = (extra: Partial<ImagemGaleria> = {}): ImagemGaleria => ({
  id: 'i1', cor: 'Preto', missao: 1, geracao: 1, status: 'gerada', alertas: [], erro: null,
  exibida: false, url: 'https://signed/i1.png', roteiro_id: 'P1', pode_gerar_de_novo: true, unit_cents: 50, ...extra,
});
const lista = (imagens: ImagemGaleria[] = [], extra: Partial<RespostaListar> = {}): RespostaListar => ({
  titulo: 'FITAS VELUDO 16MM 25M | 100% POLIÉSTER', cores: ['Preto', 'Rosa'], moda: false, unit_cents: 50,
  posicoes: NOMES.map((nome, k) => ({ posicao: k + 1, nome })), plano_id: 'P1', imagens, ...extra,
});
const aprovada = (extra: Partial<ImagemGaleria> = {}) => imagem({ id: 'g1', status: 'aprovada', exibida: true, url: null, pode_gerar_de_novo: false, ...extra });

/** Navegação de teste (troca o MLB da rota sem remontar o roteador). */
function Ir({ para }: { para: string }) {
  const nav = useNavigate();
  return <button type="button" onClick={() => nav(para)}>ir-{para}</button>;
}
function Publicados() {
  return <p>Publicados{useLocation().search}</p>;
}
function abrir(ml = 'MLB1') {
  return render(
    <MemoryRouter initialEntries={[`/publicados/${ml}/galeria`]}>
      <Ir para="/publicados/MLB-B/galeria" />
      <Routes>
        <Route path="/publicados/:mlItemId/galeria" element={<GaleriaIA />} />
        <Route path="/publicados" element={<Publicados />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  ctx.modulos = ['imagem_ia']; ctx.admin = true;
  api.listarImagens.mockResolvedValue(ok(lista()));
  api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [] }));
  api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
  api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
  api.prepararUploadFinal.mockResolvedValue(ok({ path: 'p', token: 't', signed_url: 'u' }));
  api.enviarFinal.mockResolvedValue(null);
  api.aprovarFinal.mockResolvedValue(ok({ status: 'aprovada' }));
});

describe('GaleriaIA: guarda própria (link direto)', () => {
  it('sem o módulo imagem_ia: mensagem e volta, sem chamar a edge', async () => {
    ctx.modulos = ['estoque'];
    abrir();
    expect(await screen.findByRole('alert')).toHaveTextContent(/módulo de imagens por IA não está ligado/);
    expect(api.listarImagens).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Voltar a Publicados/ }));
    expect(await screen.findByText('Publicados')).toBeInTheDocument();
  });

  it('lista de módulos carregando: não chama a edge e mostra o carregamento', async () => {
    ctx.modulos = undefined;
    abrir();
    expect(await screen.findByText('Abrindo a galeria…')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(api.listarImagens).not.toHaveBeenCalled();
  });

  it('MLB inexistente ou de outra org (anuncio_ambiguo): mensagem e volta', async () => {
    api.listarImagens.mockResolvedValue(falha(409, 'anuncio_ambiguo'));
    abrir('MLB999');
    expect(await screen.findByRole('alert')).toHaveTextContent(/não existe ou não é desta organização/);
    expect(screen.getByRole('button', { name: /Voltar a Publicados/ })).toBeInTheDocument();
  });

  it('voltar a Publicados preserva filtros (busca guardada pelo botão)', async () => {
    guardarRetorno('?filtro=fita&pagina=2');
    abrir();
    await userEvent.click(await screen.findByRole('link', { name: /Publicados/ }));
    expect(await screen.findByText('Publicados?filtro=fita&pagina=2')).toBeInTheDocument();
  });
});

describe('GaleriaIA: tela única', () => {
  it('abre direto na tela única: lê só as imagens, sem ficha nem roteiro, e mostra título, MLB e preço por imagem', async () => {
    abrir();
    expect(await screen.findByText('FITAS VELUDO 16MM 25M | 100% POLIÉSTER')).toBeInTheDocument();
    expect(screen.getByText('MLB1')).toBeInTheDocument();
    expect(await screen.findByText(/R\$\s0,50 por imagem/)).toBeInTheDocument();
    expect(await screen.findAllByRole('button', { name: /^Gerar · / })).toHaveLength(7);
    expect(api.montarFicha).not.toHaveBeenCalled();
    expect(api.lerRoteiro).not.toHaveBeenCalled();
    expect(api.listarImagens).toHaveBeenCalledWith('MLB1');
  });

  it('título do cache de Publicados enquanto a lista não chegou', async () => {
    api.listarImagens.mockReturnValue(new Promise(() => undefined));
    abrir();
    expect(await screen.findByText('FITAS VELUDO 16MM 25M')).toBeInTheDocument();
  });

  it('seletor de cor: a primeira cor abre escolhida; trocar mostra a outra; "Todas as cores" faz uma faixa por cor', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem({ id: 'a', cor: 'Preto' }), imagem({ id: 'b', cor: 'Rosa', missao: 2 })])));
    abrir();
    await screen.findByAltText('Capa · Preto');
    expect(screen.getByRole('combobox', { name: 'Cor das imagens' })).toHaveTextContent('Preto');
    expect(screen.queryByAltText('Em uso · Rosa')).toBeNull();
    const user = userEvent.setup();
    await escolherNoSelect(user, 'Cor das imagens', 'Rosa');
    expect(await screen.findByAltText('Em uso · Rosa')).toBeInTheDocument();
    expect(screen.queryByAltText('Capa · Preto')).toBeNull();
    await escolherNoSelect(user, 'Cor das imagens', 'Todas as cores');
    expect(await screen.findByRole('heading', { name: 'Preto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rosa' })).toBeInTheDocument();
  });

  it('linhas split da mesma família: cada galeria lista, gera, confirma e aprova com o ml_item_id da sua linha', async () => {
    for (const ml of ['MLB-A', 'MLB-B']) {
      vi.clearAllMocks();
      api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
      api.confirmarExibicao.mockResolvedValue(ok({ cobradas: 1 }));
      api.gerarImagens.mockResolvedValue(ok({ pedido_id: 'p', imagens: [] }));
      api.prepararUploadFinal.mockResolvedValue(ok({ path: 'p', token: 't', signed_url: 'u' }));
      api.enviarFinal.mockResolvedValue(null);
      api.aprovarFinal.mockResolvedValue(ok({ status: 'aprovada' }));
      api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [] }));
      const r = abrir(ml);
      fireEvent.load(await screen.findByAltText('Capa · Preto'));
      expect(api.listarImagens).toHaveBeenCalledWith(ml);
      expect(api.listarImagens.mock.calls.every((c) => c[0] === ml)).toBe(true);
      await waitFor(() => expect(api.confirmarExibicao).toHaveBeenCalledWith(ml, ['i1']));
      await userEvent.click(screen.getByRole('button', { name: 'Gerar outra' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar' }));
      await waitFor(() => expect(api.gerarImagens.mock.calls[0][0]).toBe(ml));
      await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
      await waitFor(() => expect(api.aprovarFinal).toHaveBeenCalledWith(ml, 'i1'));
      expect(api.prepararUploadFinal).toHaveBeenCalledWith(ml, 'i1');
      r.unmount();
    }
  });

  it('troca do MLB na rota no meio da abertura descarta a resposta antiga', async () => {
    const lentas: Record<string, (v: unknown) => void> = {};
    api.listarImagens.mockImplementation((id: string) => new Promise((r) => { lentas[id] = r; }));
    abrir('MLB-A');
    await waitFor(() => expect(api.listarImagens).toHaveBeenCalledWith('MLB-A'));
    await userEvent.click(screen.getByRole('button', { name: 'ir-/publicados/MLB-B/galeria' }));
    await waitFor(() => expect(api.listarImagens).toHaveBeenCalledWith('MLB-B'));
    lentas['MLB-B'](ok(lista([imagem({ id: 'b' })], { titulo: 'Produto B' })));
    expect(await screen.findByText('Produto B')).toBeInTheDocument();
    lentas['MLB-A'](ok(lista([], { titulo: 'Produto A' })));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Produto A')).toBeNull();
  });

  it('listar falhou (5xx): mostra o erro no lugar das imagens', async () => {
    api.listarImagens.mockResolvedValue(falha(500, 'falha_interna'));
    abrir();
    expect(await screen.findByText(/Erro interno/)).toBeInTheDocument();
  });
});

describe('GaleriaIA: seção "Colocar no anúncio"', () => {
  const secao = () => screen.queryByRole('heading', { name: 'Colocar no anúncio' });

  it('sem imagem aprovada: a seção não aparece', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([imagem()])));
    abrir();
    await screen.findByAltText('Capa · Preto');
    expect(secao()).toBeNull();
    expect(api.estadoAplicacoes).not.toHaveBeenCalled();
  });

  it('com aprovada da cor escolhida: aparece e lê o estado pelo MLB da rota; sem admin, não deixa aplicar', async () => {
    ctx.admin = false;
    api.listarImagens.mockResolvedValue(ok(lista([aprovada()])));
    abrir('MLB-B');
    expect(await screen.findByRole('heading', { name: 'Colocar no anúncio' })).toBeInTheDocument();
    await waitFor(() => expect(api.estadoAplicacoes).toHaveBeenCalledWith('MLB-B'));
    expect(screen.getByRole('button', { name: /Aplicar na cor Preto/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver prévia' })).toBeDisabled();
  });

  it('aprovada de outra cor ou de plano antigo não conta; "Todas as cores" esconde a seção', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([aprovada({ id: 'r', cor: 'Rosa' }), aprovada({ id: 'v', roteiro_id: 'P0' })])));
    abrir();
    await screen.findByText('FITAS VELUDO 16MM 25M | 100% POLIÉSTER');
    await screen.findAllByRole('button', { name: /^Gerar /i });
    expect(secao()).toBeNull();
    const user = userEvent.setup();
    await escolherNoSelect(user, 'Cor das imagens', 'Rosa');
    expect(await screen.findByRole('heading', { name: 'Colocar no anúncio' })).toBeInTheDocument();
    await escolherNoSelect(user, 'Cor das imagens', 'Todas as cores');
    await waitFor(() => expect(secao()).toBeNull());
  });

  it('familia_nao_vigente no aplicar: mostra o aviso uma vez e recomeça a leitura das imagens', async () => {
    api.listarImagens.mockResolvedValue(ok(lista([aprovada()])));
    api.prepararAplicacao.mockResolvedValue(falha(409, 'familia_nao_vigente', { familia_id_vigente: 'F2' }));
    abrir('MLB-B');
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    await waitFor(() => expect(api.listarImagens).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/cadastro do anúncio mudou/)).toBeInTheDocument();
    expect(screen.getAllByText(/cadastro do anúncio mudou/)).toHaveLength(1);
  });
});

describe('BotaoGaleria (gate do módulo imagem_ia)', () => {
  function Pagina() { return <p>página {useLocation().pathname}</p>; }
  function Linha({ modulo }: { modulo: boolean }) {
    return (
      <MemoryRouter initialEntries={['/publicados?filtro=fita']}>
        <Routes>
          <Route path="/publicados" element={<BotaoGaleria temImagemIA={modulo} mlItemId="MLB9" />} />
          <Route path="/publicados/:mlItemId/galeria" element={<Pagina />} />
        </Routes>
      </MemoryRouter>
    );
  }
  it('sem o módulo não há botão', () => {
    render(<Linha modulo={false} />);
    expect(screen.queryByRole('button', { name: /Galeria IA/ })).toBeNull();
  });
  it('com o módulo, o botão tem texto, abre a página da linha e guarda os filtros para a volta', async () => {
    render(<Linha modulo />);
    await userEvent.click(screen.getByRole('button', { name: 'Galeria IA' }));
    expect(await screen.findByText(/página/)).toBeInTheDocument();
    expect(lerRetorno()?.busca).toBe('?filtro=fita');
  });
});
