// Fase C (plano 2026-11-11): Galeria IA em página própria. Casos migrados do antigo `dialog-galeria.test.tsx` e
// `passo-roteiro.test.tsx` (abertura sequencial, identidade, bloqueio por módulo, fatos, roteiro, lupa) e os novos da
// seção (c) da revisão: link direto sem módulo, não-admin, MLB inexistente, voltar preservando filtros, erro em seção
// recolhida, remoção de spec com campo repetido.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import GaleriaIA from '../GaleriaIA';
import { BotaoGaleria } from '@/components/galeria/botao-galeria';
import { guardarRetorno, lerRetorno } from '@/lib/galeria/retorno';
import type { Fato, Ficha, MissaoRoteiro, RespostaRoteiro, Res } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({
  montarFicha: vi.fn(), lerRoteiro: vi.fn(), confirmarFato: vi.fn(), descartarFato: vi.fn(), manterCadastro: vi.fn(),
  corrigirCadastro: vi.fn(), enviarVista: vi.fn(), criarRoteiro: vi.fn(), salvarRoteiro: vi.fn(), aprovarRoteiro: vi.fn(),
  listarImagens: vi.fn(), estadoAplicacoes: vi.fn(), prepararAplicacao: vi.fn(),
}));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const ctx = vi.hoisted(() => ({ modulos: ['imagem_ia'] as string[] | undefined, admin: true }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ctx.modulos }) }));
vi.mock('@/hooks/useOperacoes', () => ({ usePodeExecutarOperacao: () => ctx.admin }));
vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => ({ data: [{ mlItemId: 'MLB1', titulo: 'FITAS VELUDO 16MM 25M', precoPublicacao: 28.4, codigoPai: '0001' }] }),
}));
/** null = a trava real (MISSOES_LUPA_PENDENTE); {geral:[],moda:[]} = ramo liberado depois do portão (Task 16). */
const trava = vi.hoisted(() => ({ travas: null as null | { geral: number[]; moda: number[] } }));
vi.mock('../../../supabase/functions/_shared/galeria/regras', async (orig) => {
  const r = await orig<typeof import('../../../supabase/functions/_shared/galeria/regras')>();
  return { ...r, lupaPendente: (m: number, moda: boolean) => r.lupaPendente(m, moda, trava.travas ?? r.MISSOES_LUPA_PENDENTE) };
});

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (status: number, erro: string, corpo: Record<string, unknown> = {}): Res<never> => ({ ok: false, status, erro, corpo });

const fato = (campo: string, estado: Fato['estado'], valor = 'v', extra: Partial<Fato> = {}): Fato =>
  ({ campo, valor, estado, origem: 'planilha', ...extra });
const ficha = (fatos: Fato[], extra: Partial<Ficha> = {}): Ficha => ({
  anuncio_externo_id: 'A1', familia_id: 'F1', codigo_pai: '0001', cores: ['Preto'], fatos, fatos_hash: 'h',
  roteiro_desatualizado: false, referencias: {}, ...extra,
});
const missao = (n: number, extra: Partial<MissaoRoteiro> = {}): MissaoRoteiro =>
  ({ missao: n, ativa: true, cena: `cena ${n}`, fatosUsados: [], ...extra } as MissaoRoteiro);
const resposta = (extra: Partial<RespostaRoteiro> & { moda?: boolean; status?: string; missoes?: MissaoRoteiro[] } = {}): RespostaRoteiro => {
  const { moda = false, status = 'rascunho', missoes, ...resto } = extra;
  return {
    roteiro: { id: 'R1', familia_id: 'F1', versao: 1, status, moda, conteudo: { categoria: 'c', contrato: 'contrato',
      missoes: missoes ?? [missao(1), missao(2, { headline: 'um dois três quatro cinco seis' })] } },
    erros: [], erros_por_missao: {}, ciencia_pendente: [], fatos: [], ...resto,
  };
};
const comLer = (r: RespostaRoteiro | null) => ok(r ? { ...r, moda: r.roteiro.moda, familia_id: 'F1' } : { roteiro: null, moda: false, familia_id: 'F1' });

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
async function irPasso(nome: RegExp) {
  const b = await screen.findByRole('button', { name: nome });
  await waitFor(() => expect(b).toBeEnabled());
  await userEvent.click(b);
}
const continuar = () => screen.getByRole('button', { name: /^Continuar/ });
const rodape = () => screen.getAllByRole('status').at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  ctx.modulos = ['imagem_ia']; ctx.admin = true; trava.travas = null;
  api.montarFicha.mockResolvedValue(ok(ficha([fato('nome', 'CONFIRMADO', 'Fita')])));
  api.lerRoteiro.mockResolvedValue(comLer(null));
  api.listarImagens.mockResolvedValue(ok({ roteiro: null, unit_cents: 0, imagens: [] }));
  api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [] }));
  api.salvarRoteiro.mockImplementation(async (_m: string, _f: string, _id: string, c) => ok({ ...resposta(), roteiro: { ...resposta().roteiro, conteudo: c } }));
});

describe('GaleriaIA: guarda própria (link direto)', () => {
  it('sem o módulo imagem_ia: mensagem e volta, sem chamar a edge', async () => {
    ctx.modulos = ['estoque'];
    abrir();
    expect(await screen.findByRole('alert')).toHaveTextContent(/módulo de imagens por IA não está ligado/);
    expect(api.montarFicha).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Voltar a Publicados/ }));
    expect(await screen.findByText('Publicados')).toBeInTheDocument();
  });

  // Revisão B+C (Grok, achado 6): com a lista de módulos ainda carregando, a página espera; não chama o montar.
  it('lista de módulos carregando: não chama montar e mostra o carregamento', async () => {
    ctx.modulos = undefined;
    abrir();
    expect(await screen.findByText('Abrindo a galeria…')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(api.montarFicha).not.toHaveBeenCalled();
  });

  it('MLB inexistente ou de outra org (anuncio_ambiguo): mensagem e volta; não lê o roteiro', async () => {
    api.montarFicha.mockResolvedValue(falha(409, 'anuncio_ambiguo'));
    abrir('MLB999');
    expect(await screen.findByRole('alert')).toHaveTextContent(/não existe ou não é desta organização/);
    expect(api.lerRoteiro).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Voltar a Publicados/ })).toBeInTheDocument();
  });

  it('voltar a Publicados preserva filtros (busca guardada pelo botão)', async () => {
    guardarRetorno('?filtro=fita&pagina=2');
    abrir();
    await userEvent.click(await screen.findByRole('link', { name: /Publicados/ }));
    expect(await screen.findByText('Publicados?filtro=fita&pagina=2')).toBeInTheDocument();
  });

  it('cabeçalho mostra o anúncio da linha (título, MLB, preço e cores)', async () => {
    abrir();
    expect(await screen.findByText('FITAS VELUDO 16MM 25M')).toBeInTheDocument();
    expect(screen.getByText('MLB1')).toBeInTheDocument();
    expect(await screen.findByText('Cores: Preto')).toBeInTheDocument();
  });
});

describe('GaleriaIA: abertura sequencial e identidade', () => {
  it('chama montar e só depois ler; o aviso reflete o estado pós-montar (desatualizado)', async () => {
    const ordem: string[] = [];
    let liberar: (v: unknown) => void = () => undefined;
    api.montarFicha.mockImplementation(() => { ordem.push('montar'); return new Promise((r) => { liberar = r; }); });
    api.lerRoteiro.mockImplementation(async () => { ordem.push('ler'); return comLer(resposta({ status: 'desatualizado' })); });
    abrir();
    await waitFor(() => expect(ordem).toEqual(['montar']));
    expect(api.lerRoteiro).not.toHaveBeenCalled();
    liberar(ok(ficha([fato('nome', 'CONFIRMADO')])));
    await waitFor(() => expect(ordem).toEqual(['montar', 'ler']));
    await irPasso(/Escolher imagens/);
    expect((await screen.findAllByText(/Os dados mudaram depois da aprovação/)).length).toBeGreaterThan(0);
  });

  it('com ler pendente não há "Criar"; com ler → roteiro null ele aparece e manda o MLB da rota e a família vigente', async () => {
    let liberar: (v: unknown) => void = () => undefined;
    api.lerRoteiro.mockReturnValue(new Promise((r) => { liberar = r; }));
    api.criarRoteiro.mockResolvedValue(ok(resposta()));
    abrir('MLB-A');
    await waitFor(() => expect(api.lerRoteiro).toHaveBeenCalledWith('MLB-A'));
    expect(screen.getByRole('button', { name: /Escolher imagens/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Criar os textos/ })).toBeNull();
    liberar(comLer(null));
    await waitFor(() => expect(continuar()).toBeEnabled());
    await userEvent.click(continuar());
    await userEvent.click(await screen.findByRole('button', { name: /Criar os textos com IA/ }));
    expect(api.criarRoteiro).toHaveBeenCalledWith('MLB-A', 'F1');
  });

  it('ler falhou: não oferece "Criar" (não sabe se há roteiro vigente)', async () => {
    api.lerRoteiro.mockResolvedValue(falha(500, 'falha_interna'));
    abrir();
    await waitFor(() => expect(continuar()).toBeEnabled());
    await userEvent.click(continuar());
    await screen.findByText('Escolher imagens', { selector: 'h1' });
    expect(screen.queryByRole('button', { name: /Criar os textos/ })).toBeNull();
    expect(screen.getByText(/Não foi possível ler os textos/)).toBeInTheDocument();
  });

  it('troca do MLB na rota no meio da abertura descarta a resposta antiga', async () => {
    const lentas: Record<string, (v: unknown) => void> = {};
    api.montarFicha.mockImplementation((id: string) => new Promise((r) => { lentas[id] = r; }));
    abrir('MLB-A');
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledWith('MLB-A'));
    await userEvent.click(screen.getByRole('button', { name: 'ir-/publicados/MLB-B/galeria' }));
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledWith('MLB-B'));
    lentas['MLB-B'](ok(ficha([fato('atributo:MATERIAL', 'CONFIRMADO', 'Produto B')])));
    expect(await screen.findByText('Produto B')).toBeInTheDocument();
    lentas['MLB-A'](ok(ficha([fato('atributo:MATERIAL', 'CONFIRMADO', 'Produto A')])));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Produto A')).toBeNull();
    expect(api.lerRoteiro).not.toHaveBeenCalledWith('MLB-A');
  });

  it('montar falhou: mostra o erro e não chama ler', async () => {
    api.montarFicha.mockResolvedValue(falha(500, 'falha_interna'));
    abrir();
    expect(await screen.findByText(/Erro interno/)).toBeInTheDocument();
    expect(api.lerRoteiro).not.toHaveBeenCalled();
  });
});

describe('Passo 1: Conferir dados', () => {
  const divergente = (foto: { origem: 'referencia' | 'ml'; ref: string; url?: string }) => ficha([fato('atributo:WIDTH', 'DIVERGENTE', '16 mm', {
    etiqueta: { legivel: true, valor: '15 mm', foto, caixa: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
  })]);
  const carregarRecorte = async (evento: 'load' | 'error') => {
    const recorte = await screen.findByRole('img', { name: 'Recorte da etiqueta' });
    fireEvent[evento](recorte.querySelector('img')!);
  };

  it('divergência: com o recorte carregado, "Usar o da etiqueta" corrige o cadastro; o rodapé diz o que falta', async () => {
    api.montarFicha.mockResolvedValue(ok(divergente({ origem: 'referencia', ref: 'o/a.jpg', url: 'https://x.test/a.jpg' })));
    api.corrigirCadastro.mockResolvedValue(ok(ficha([fato('atributo:WIDTH', 'CONFIRMADO', '15 mm')])));
    abrir();
    expect(await screen.findByText(/A etiqueta mostra outro valor de largura/)).toBeInTheDocument();
    expect(rodape()).toHaveTextContent(/Escolha o valor de largura/);
    expect(continuar()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Usar o da etiqueta' })).toBeDisabled();
    await carregarRecorte('load');
    await userEvent.click(screen.getByRole('button', { name: 'Usar o da etiqueta' }));
    expect(api.corrigirCadastro).toHaveBeenCalledWith('MLB1', 'F1', 'atributo:WIDTH', '15 mm');
    await waitFor(() => expect(continuar()).toBeEnabled());
  });

  it('divergência de foto do ML usa a URL que veio da edge (a tela não monta URL de CDN)', async () => {
    api.montarFicha.mockResolvedValue(ok(divergente({ origem: 'ml', ref: 'PIC1', url: 'https://http2.mlstatic.com/D_NQ_X-O.jpg' })));
    abrir();
    const recorte = await screen.findByRole('img', { name: 'Recorte da etiqueta' });
    expect(recorte.querySelector('img')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_NQ_X-O.jpg');
    expect(recorte.style.backgroundImage).toContain('https://http2.mlstatic.com/D_NQ_X-O.jpg');
  });

  it('recorte que não carrega (ou sem URL): só dá para manter o cadastro', async () => {
    api.montarFicha.mockResolvedValue(ok(divergente({ origem: 'referencia', ref: 'o/a.jpg', url: 'https://x.test/quebrada.jpg' })));
    api.manterCadastro.mockResolvedValue(ok(ficha([fato('atributo:WIDTH', 'CONFIRMADO', '16 mm')])));
    abrir();
    await carregarRecorte('error');
    expect(await screen.findByText(/Não foi possível mostrar o recorte/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar o da etiqueta' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Manter cadastro' }));
    expect(api.manterCadastro).toHaveBeenCalledWith('MLB1', 'F1', 'atributo:WIDTH');
    expect(api.corrigirCadastro).not.toHaveBeenCalled();
  });

  it('divergência de campo não corrigível (ORIGEM): só manter o cadastro', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('origem', 'DIVERGENTE', 'NACIONAL', { etiqueta: { legivel: true, valor: 'China' } })])));
    abrir();
    expect(await screen.findByRole('button', { name: 'Usar o da etiqueta' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Manter cadastro' })).toBeEnabled();
  });

  it('sugestão: rótulo em português; "Usar nas imagens" confirma; "Confirmar todos" confirma em sequência, sem as descrições', async () => {
    const inicial = ficha([
      fato('atributo:MATERIAL', 'SUGERIDO', '100% poliéster'), fato('atributo:UNITS_PER_PACK', 'SUGERIDO', '1'),
      fato('descricao_ml', 'SUGERIDO', 'Descrição longa do anúncio'),
    ]);
    api.montarFicha.mockResolvedValue(ok(inicial));
    api.confirmarFato.mockImplementation(async () => ok(inicial));
    abrir();
    expect(await screen.findByText('Material')).toBeInTheDocument();
    expect(screen.queryByText('atributo:MATERIAL')).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Usar Material nas imagens' }));
    expect(api.confirmarFato).toHaveBeenLastCalledWith('MLB1', 'F1', 'atributo:MATERIAL');
    api.confirmarFato.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /Confirmar todos/ }));
    await waitFor(() => expect(api.confirmarFato).toHaveBeenCalledTimes(2));
    expect(api.confirmarFato.mock.calls.map((c) => c[2])).toEqual(['atributo:MATERIAL', 'atributo:UNITS_PER_PACK']);
    // A descrição tem confirmação própria, dentro de "Ver todos os dados do cadastro".
    expect(screen.getByRole('button', { name: 'Confirmar Descrição no Mercado Livre' })).toBeInTheDocument();
  });

  it('medida que varia por tamanho é explicada; embalagem fica em "Ver todos os dados"', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('nome', 'CONFIRMADO', 'Fita'), fato('largura_cm', 'VARIA_POR_TAMANHO', '20 / 30'), fato('peso_gramas', 'CONFIRMADO', '287')])));
    abrir();
    expect(await screen.findByText(/muda de um tamanho para outro/)).toBeInTheDocument();
    expect(screen.getByText('Peso da embalagem')).toBeInTheDocument();
    expect(rodape()).toHaveTextContent('1 dado confirmado vai para as imagens');
  });

  it('roteiro desatualizado avisa já no passo 1', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('nome', 'CONFIRMADO')], { roteiro_desatualizado: true })));
    abrir();
    expect(await screen.findByRole('alert')).toHaveTextContent(/mudaram depois que os textos foram aprovados/);
  });

  it.each([[false], [null]])('sem Moda confirmada (moda=%s) o envio de costas nunca aparece', async (moda) => {
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda, familia_id: 'F1' }));
    abrir();
    await screen.findByText('Conferir dados', { selector: 'h1' });
    expect(screen.queryByRole('button', { name: /Enviar foto de costas/ })).toBeNull();
  });

  it('com Moda confirmada pela edge o envio de costas aparece', async () => {
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda: true, familia_id: 'F1' }));
    abrir();
    expect(await screen.findByRole('button', { name: /Enviar foto de costas/ })).toBeInTheDocument();
  });
});

describe('Passo 2: Escolher imagens', () => {
  async function noPasso2(r: RespostaRoteiro, f: Ficha = ficha([fato('nome', 'CONFIRMADO')])) {
    api.montarFicha.mockResolvedValue(ok(f));
    api.lerRoteiro.mockResolvedValue(comLer(r));
    abrir();
    await irPasso(/Escolher imagens/);
    await screen.findByText('Escolher imagens', { selector: 'h1' });
  }

  it('contador de palavras com o limite de regras.ts; acima dele, erro de uma linha ao lado do campo', async () => {
    await noPasso2(resposta());
    expect(screen.getByText('6 de 5 palavras')).toHaveAttribute('data-excedeu', 'true');
    const titulo = screen.getByLabelText(/^Título/);
    expect(titulo).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Encurte para até 5 palavras');
    expect(continuar()).toBeDisabled();
    expect(rodape()).toHaveTextContent('Ajuste os textos de Onde usar');
  });

  it('erro do servidor aparece traduzido no cartão, sem o texto interno', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })], erros: ['Missão 2: termo proibido "frete"'], erros_por_missao: { '2': ['Missão 2: termo proibido "frete"'] } }));
    expect(screen.getByRole('alert')).toHaveTextContent('"frete" não pode aparecer na imagem');
    expect(screen.queryByText(/Missão 2:/)).toBeNull();
    expect(continuar()).toBeDisabled();
  });

  it('erro em seção recolhida (cena vazia) abre "Ajustes avançados" sozinho', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme', cena: '' })], erros: ['Missão 2: cena vazia'], erros_por_missao: { '2': ['Missão 2: cena vazia'] } }));
    const detalhes = screen.getByText('Ajustes avançados').closest('details')!;
    expect(detalhes.open).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Descreva a cena da imagem.');
    expect(screen.getByLabelText('Descrição da cena')).toHaveAttribute('aria-invalid', 'true');
  });

  it('sem erro, "Ajustes avançados" fica recolhido', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    expect(screen.getByText('Ajustes avançados').closest('details')!.open).toBe(false);
  });

  it('texto que estoura a largura da caixa bloqueia o Continuar, com o motivo ao lado do campo', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Aplicação extraordinária instantânea profissionalíssima garantida' })] }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Passou \d+ caracteres; encurte para caber/);
    // O contador do campo fica em alerta junto do erro (não mostra "10 de 10" neutro ao lado dele).
    const contador = document.getElementById('f-headline-n')!;
    expect(contador).toHaveAttribute('data-excedeu', 'true');
    expect(contador).toHaveClass('text-destructive');
    expect(continuar()).toBeDisabled();
  });

  it('Moda não bloqueia por largura (imagem sem texto)', async () => {
    await noPasso2(resposta({ moda: true, missoes: [missao(1), missao(2, { headline: 'Aplicação extraordinária instantânea profissionalíssima garantida' })] }));
    expect(continuar()).toBeEnabled();
  });

  it('ciência em lote lista os dados sem etiqueta; marcada, o Continuar aprova mandando os campos', async () => {
    api.aprovarRoteiro.mockResolvedValue(ok({ roteiro_id: 'R1', status: 'aprovado', fatos_hash: 'h' }));
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })], ciencia_pendente: ['atributo:MATERIAL'] }),
      ficha([fato('atributo:MATERIAL', 'NAO_CONFERIDO', '100% poliéster')]));
    expect(screen.getByText(/Alguns dados não aparecem na etiqueta: Material/)).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Usar mesmo assim/ }));
    expect(continuar()).toBeEnabled();
    await userEvent.click(continuar());
    await waitFor(() => expect(api.aprovarRoteiro).toHaveBeenCalledWith('MLB1', 'F1', 'R1', ['atributo:MATERIAL']));
  });

  it('ciência que surge no salvar feito pelo Continuar: não aprova sem o operador marcar (R1.3)', async () => {
    api.salvarRoteiro.mockImplementation(async (_m: string, _f: string, _id: string, c) =>
      ok({ ...resposta({ ciencia_pendente: ['atributo:MATERIAL'] }), roteiro: { ...resposta().roteiro, conteudo: c } }));
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }),
      ficha([fato('atributo:MATERIAL', 'NAO_CONFERIDO', '100% poliéster')]));
    await userEvent.type(screen.getByLabelText(/^Título/), ' poliéster');
    await userEvent.click(continuar());
    expect(await screen.findByText(/Alguns dados não aparecem na etiqueta: Material/)).toBeInTheDocument();
    expect(api.salvarRoteiro).toHaveBeenCalled();
    expect(api.aprovarRoteiro).not.toHaveBeenCalled();
    expect(continuar()).toBeDisabled();
  });

  it('não-admin: só leitura, com aviso; não aprova nem liga imagem', async () => {
    ctx.admin = false;
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    expect(screen.getByText(/Somente administradores editam e aprovam/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Título/)).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Criar a imagem Onde usar' })).toBeDisabled();
    expect(continuar()).toBeDisabled();
    expect(rodape()).toHaveTextContent(/Somente administradores aprovam/);
  });

  it.each([
    ['categoria_mudou', /categoria do anúncio mudou/],
    ['conteudo_mudou', /alterados em outra aba/],
  ])('409 %s no aprovar: mensagem clara e recarrega', async (codigo, msg) => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    api.aprovarRoteiro.mockResolvedValue(falha(409, codigo as string));
    api.montarFicha.mockClear();
    api.lerRoteiro.mockResolvedValue(comLer(null));
    await userEvent.click(continuar());
    expect(await screen.findByText(msg as RegExp)).toBeInTheDocument();
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /Criar os textos com IA/ })).toBeInTheDocument();
  });

  it('503 categoria_indisponivel no aprovar: mensagem clara e os textos continuam', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    api.aprovarRoteiro.mockResolvedValue(falha(503, 'categoria_indisponivel'));
    await userEvent.click(continuar());
    expect(await screen.findByText(/ler a categoria no Mercado Livre/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Título/)).toHaveValue('Prende firme');
    expect(continuar()).toBeEnabled();
  });

  // Revisão B+C (Grok, achado 1): a recusa do aprovar só traz erros/pendências; a edição feita enquanto ele respondia
  // fica na tela e sai no salvar seguinte.
  it.each([
    ['roteiro_invalido', { erros: ['título longo'], erros_por_missao: {} }],
    ['ciencia_pendente', { campos: ['atributo:MATERIAL'] }],
  ])('edição durante o aprovar que volta com %s é preservada e salva depois', async (codigo, corpo) => {
    let responder!: (r: Res<never>) => void;
    api.aprovarRoteiro.mockReturnValue(new Promise((r) => { responder = r; }));
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    await userEvent.click(continuar());
    await waitFor(() => expect(api.aprovarRoteiro).toHaveBeenCalled());
    await userEvent.type(screen.getByLabelText(/^Título/), ' sempre');
    responder(falha(409, codigo as string, corpo));
    await waitFor(() => expect(api.salvarRoteiro).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.getByLabelText(/^Título/)).toHaveValue('Prende firme sempre');
    expect(api.salvarRoteiro.mock.calls.at(-1)![3].missoes[1].headline).toBe('Prende firme sempre');
  });

  // Revisão B+C (Grok, achado 2): voltar a Publicados com o salvar falhando avisa e fica, como a troca de passo.
  it('voltar a Publicados com o salvar falhando: toast de erro e permanece na galeria', async () => {
    const { toast } = await import('sonner');
    api.salvarRoteiro.mockResolvedValue(falha(500, 'falha_interna'));
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    await userEvent.type(screen.getByLabelText(/^Título/), ' sempre');
    await userEvent.click(screen.getByRole('link', { name: /Publicados/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Não foi possível salvar/)));
    expect(screen.getByText('Escolher imagens', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.queryByText(/^Publicados/, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('roteiro aprovado: só leitura com "Editar"; Continuar segue sem aprovar de novo', async () => {
    api.listarImagens.mockResolvedValue(ok({ roteiro: { id: 'R1', versao: 1, familia_id: 'F1', moda: false, missoes_ativas: [1, 2], textos: {} }, unit_cents: 50, imagens: [] }));
    await noPasso2(resposta({ status: 'aprovado', missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    expect(screen.queryByRole('button', { name: /Criar os textos/ })).toBeNull();
    expect(screen.getByLabelText(/^Título/)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Editar/ })).toBeInTheDocument();
    await userEvent.click(continuar());
    expect(api.aprovarRoteiro).not.toHaveBeenCalled();
    expect(await screen.findByText('Gerar e aprovar', { selector: 'h1' })).toBeInTheDocument();
  });

  it('escolher um cartão rola até o editor e leva o foco ao título dele', async () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' }), missao(5, { headline: 'Dados do produto', specs: [] })] }));
    await userEvent.click(screen.getByRole('button', { name: 'Ficha técnica: ver textos' }));
    const titulo = screen.getByRole('heading', { name: 'Ficha técnica', level: 2 });
    expect(titulo).toHaveFocus();
    expect(rolar).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
  });

  it('ficha técnica: remover a 2ª spec com o mesmo campo repetido tira só ela e salva sozinho', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(5, { headline: 'Dados do produto', specs: [
      { campo: 'descricao_ml', rotulo: 'Composição', valor: '100% poliéster' },
      { campo: 'descricao_ml', rotulo: 'Metragem', valor: '25 metros' },
    ] })] }));
    await userEvent.click(screen.getByRole('button', { name: 'Ficha técnica: ver textos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover dado 2' }));
    expect(screen.queryByText('25 metros')).toBeNull();
    expect(screen.getByText('100% poliéster')).toBeInTheDocument();
    await waitFor(() => expect(api.salvarRoteiro).toHaveBeenCalled(), { timeout: 3000 });
    const enviado = api.salvarRoteiro.mock.calls.at(-1)![3];
    expect(enviado.missoes[1].specs).toEqual([{ campo: 'descricao_ml', rotulo: 'Composição', valor: '100% poliéster' }]);
  });

  it('só os campos que a imagem mostra: "Onde usar" tem título e subtítulo, sem benefícios nem passos', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' })] }));
    expect(screen.getByLabelText(/^Título/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Subtítulo/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Benefício/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /^Passo/ })).toBeNull();
  });

  it('missão desligada pelo servidor mostra o motivo em português (nunca "ativa, será ignorada")', async () => {
    await noPasso2(resposta({ missoes: [missao(1), missao(2, { headline: 'Prende firme' }),
      missao(6, { ativa: false, motivoDesligada: 'Sem etapa de uso escrita nos dados confirmados (R5.3)' })] }));
    const como = screen.getByText('Como usar').closest('li')!;
    expect(within(como).getByText('O cadastro não tem instruções de uso.')).toBeInTheDocument();
    expect(within(como).getByRole('switch')).toBeDisabled();
    expect(screen.queryByText(/será ignorada/)).toBeNull();
  });
});

describe('Passo 2: lupa (migrado do passo Roteiro)', () => {
  const lupa = (r3: 'ok' | 'lendo' | 'indisponivel', r7 = r3) => ({ geral: { 3: r3, 7: r7 }, moda: { 5: 'ok' as const, 7: 'ok' as const } });
  async function comLupa(f: Ficha, ativas: number[]) {
    api.montarFicha.mockResolvedValue(ok(f));
    api.lerRoteiro.mockResolvedValue(comLer(resposta({ missoes: [1, 2, 3, 4, 5, 6, 7].map((n) => missao(n, { ativa: ativas.includes(n) })) })));
    abrir();
    await irPasso(/Escolher imagens/);
    await screen.findByText('Escolher imagens', { selector: 'h1' });
  }
  const chave = (nome: string) => screen.getByRole('switch', { name: `Criar a imagem ${nome}` });

  it('lupa travada: 3 e 7 "Em breve"; desligadas não ligam; ligada pode desligar; a capa nunca desliga', async () => {
    await comLupa(ficha([], { cores: ['Preto', 'Rosa'] }), [1, 2, 3]);
    expect(chave('Detalhe com lupa')).toBeEnabled();
    expect(within(chave('Detalhe com lupa').closest('li')!).getByText('Em breve: não será gerada')).toBeInTheDocument();
    expect(chave('Detalhes')).toBeDisabled();
    expect(within(chave('Detalhes').closest('li')!).getByText('Em breve')).toBeInTheDocument();
    expect(chave('Capa')).toBeDisabled();
  });

  it('ramo liberado: sem detalhe em UMA cor mostra o motivo com a cor e deixa ligar; em TODAS barra', async () => {
    trava.travas = { geral: [], moda: [] };
    await comLupa(ficha([], { cores: ['Preto', 'Rosa'], lupa: { Preto: lupa('ok'), Rosa: lupa('indisponivel', 'ok') } }), [1]);
    expect(screen.getByText('Sem detalhe do produto na foto: Rosa')).toBeInTheDocument();
    expect(chave('Detalhe com lupa')).toBeEnabled();
  });

  // Revisão B+C (Grok, achado 3): caso que existia no passo antigo e voltou para o passo 2.
  it('ramo liberado com a lupa sendo lida em UMA cor: motivo com a cor e o interruptor continua ligado', async () => {
    trava.travas = { geral: [], moda: [] };
    await comLupa(ficha([], { cores: ['Preto', 'Rosa'], lupa: { Preto: lupa('ok'), Rosa: lupa('lendo') } }), [1, 3]);
    // Ligada (3): continua ligada e pode desligar. Desligada (7): motivo com a cor e pode ligar.
    expect(chave('Detalhe com lupa')).toBeChecked();
    expect(chave('Detalhe com lupa')).toBeEnabled();
    expect(within(chave('Detalhes').closest('li')!).getByText(/preparando esta imagem, aguarde: Rosa/i)).toBeInTheDocument();
    expect(chave('Detalhes')).toBeEnabled();
  });

  it('ramo liberado com a lupa indisponível em todas as cores: ligar fica barrado', async () => {
    trava.travas = { geral: [], moda: [] };
    await comLupa(ficha([], { cores: ['Preto', 'Rosa'], lupa: { Preto: lupa('indisponivel', 'ok'), Rosa: lupa('indisponivel', 'ok') } }), [1]);
    expect(chave('Detalhe com lupa')).toBeDisabled();
    expect(chave('Detalhes')).toBeEnabled();
  });
});

describe('Passos 3 e 4 na página', () => {
  const aprovadaPreto = { id: 'g1', cor: 'Preto', missao: 1, geracao: 1, origem: 'gerador', status: 'aprovada', alertas: [], erro: null,
    exibida: true, url: null, ref_url: null, roteiro_id: 'R1', pode_gerar_de_novo: false, unit_cents: 50 };
  const aprovadoListar = { roteiro: { id: 'R1', versao: 1, familia_id: 'F1', moda: false, missoes_ativas: [1, 2], textos: {} }, unit_cents: 50, imagens: [aprovadaPreto] };

  it('sem roteiro aprovado nem imagem pendente, os passos 3 e 4 ficam fechados', async () => {
    abrir();
    await screen.findByText('Conferir dados', { selector: 'h1' });
    expect(screen.getByRole('button', { name: /Gerar e aprovar/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Aplicar no anúncio/ })).toBeDisabled();
  });

  it('com roteiro aprovado o passo 4 lê o estado pelo MLB da rota e, sem admin, não deixa aplicar', async () => {
    ctx.admin = false;
    api.lerRoteiro.mockResolvedValue(comLer(resposta({ status: 'aprovado' })));
    api.listarImagens.mockResolvedValue(ok(aprovadoListar));
    abrir('MLB-B');
    await irPasso(/Aplicar no anúncio/);
    await waitFor(() => expect(api.estadoAplicacoes).toHaveBeenCalledWith('MLB-B'));
    expect(screen.getByRole('button', { name: /Aplicar na cor Preto/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver prévia' })).toBeDisabled();
  });

  it('roteiro aprovado sem imagem aprovada: o passo 4 mostra o estado vazio e leva ao passo 3', async () => {
    api.lerRoteiro.mockResolvedValue(comLer(resposta({ status: 'aprovado' })));
    api.listarImagens.mockResolvedValue(ok({ ...aprovadoListar, imagens: [] }));
    abrir('MLB-B');
    await irPasso(/Aplicar no anúncio/);
    expect(await screen.findByText('Aprove ao menos 1 imagem no passo 3', { selector: 'p.font-medium' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ir para Gerar e aprovar' }));
    expect(await screen.findByText('Gerar e aprovar', { selector: 'h1' })).toBeInTheDocument();
    expect(api.prepararAplicacao).not.toHaveBeenCalled();
  });

  it('familia_nao_vigente no aplicar sobrevive à recarga, com o id vigente', async () => {
    api.lerRoteiro.mockResolvedValue(comLer(resposta({ status: 'aprovado' })));
    api.listarImagens.mockResolvedValue(ok(aprovadoListar));
    api.prepararAplicacao.mockResolvedValue(falha(409, 'familia_nao_vigente', { familia_id_vigente: 'F2' }));
    abrir('MLB-B');
    await irPasso(/Aplicar no anúncio/);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/cadastro do anúncio mudou/)).toBeInTheDocument();
    expect(screen.getAllByText(/cadastro do anúncio mudou/)).toHaveLength(1);
  });
});

// Fase C2: miniatura do cabeçalho = capa atual do anúncio (vem do `montar`); sem ela ou com erro de carga, o ícone.
describe('Cabeçalho: miniatura da capa', () => {
  it('mostra a capa do anúncio vinda do montar', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('nome', 'CONFIRMADO', 'Fita')], { capa_url: 'https://http2.mlstatic.com/C1.jpg' })));
    abrir();
    expect(await screen.findByTestId('capa-anuncio')).toHaveAttribute('src', 'https://http2.mlstatic.com/C1.jpg');
    expect(screen.queryByTestId('capa-icone')).not.toBeInTheDocument();
  });

  it('sem capa (edge antiga ou null) → ícone; imagem que não carrega → ícone', async () => {
    abrir();
    expect(await screen.findByTestId('capa-icone')).toBeInTheDocument();
    api.montarFicha.mockResolvedValue(ok(ficha([fato('nome', 'CONFIRMADO', 'Fita')], { capa_url: 'https://quebrada/x.jpg' })));
    await userEvent.click(screen.getByRole('button', { name: 'ir-/publicados/MLB-B/galeria' }));
    fireEvent.error(await screen.findByTestId('capa-anuncio'));
    expect(await screen.findByTestId('capa-icone')).toBeInTheDocument();
  });

  it('link direto sem cache de Publicados: título, formato e preço vêm do montar', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('nome', 'CONFIRMADO', 'Fita')], {
      capa_url: 'https://http2.mlstatic.com/C1.jpg', titulo_anuncio: 'FITA DO ML', preco_anuncio: 31.5, formato: 'user_products' })));
    abrir('MLB-SEM-CACHE');
    const cab = (await screen.findByTestId('capa-anuncio')).closest('header')!;
    await waitFor(() => expect(cab).toHaveTextContent('FITA DO ML'));
    expect(cab).toHaveTextContent('User Products');
    expect(cab).toHaveTextContent('R$ 31,50');
    expect(cab).toHaveTextContent('MLB-SEM-CACHE');
  });

  it('ações da ficha que não trazem a capa não apagam a miniatura', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('atributo:COLOR', 'SUGERIDO', 'Preto')], { capa_url: 'https://http2.mlstatic.com/C1.jpg' })));
    api.confirmarFato.mockResolvedValue(ok(ficha([fato('atributo:COLOR', 'CONFIRMADO', 'Preto')])));
    abrir();
    await screen.findByTestId('capa-anuncio');
    const sw = await screen.findAllByRole('switch');
    await userEvent.click(sw[0]);
    await waitFor(() => expect(api.confirmarFato).toHaveBeenCalled());
    expect(screen.getByTestId('capa-anuncio')).toBeInTheDocument();
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
