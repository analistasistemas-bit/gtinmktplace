import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogGaleria } from '../dialog-galeria';
import { BotaoGaleria } from '../botao-galeria';
import type { Fato, Ficha, RespostaRoteiro, Res } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({
  montarFicha: vi.fn(), lerRoteiro: vi.fn(), confirmarFato: vi.fn(), descartarFato: vi.fn(), manterCadastro: vi.fn(),
  corrigirCadastro: vi.fn(), enviarVista: vi.fn(), criarRoteiro: vi.fn(), salvarRoteiro: vi.fn(), aprovarRoteiro: vi.fn(),
  listarImagens: vi.fn(), estadoAplicacoes: vi.fn(),
}));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));
vi.mock('@/lib/storage', () => ({ signedUrl: vi.fn(async () => 'https://x.test/etiqueta.jpg') }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (status: number, erro: string, corpo: Record<string, unknown> = {}): Res<never> => ({ ok: false, status, erro, corpo });

const fato = (campo: string, estado: Fato['estado'], valor = 'v', extra: Partial<Fato> = {}): Fato =>
  ({ campo, valor, estado, origem: 'planilha', ...extra });
const ficha = (fatos: Fato[], extra: Partial<Ficha> = {}): Ficha => ({
  anuncio_externo_id: 'A1', familia_id: 'F1', codigo_pai: '0001', cores: ['Preto'], fatos, fatos_hash: 'h',
  roteiro_desatualizado: false, referencias: {}, ...extra,
});
const missao = (n: number, extra = {}) => ({ missao: n, ativa: true, cena: `cena ${n}`, fatosUsados: [], ...extra });
const resposta = (extra: Partial<RespostaRoteiro> & { moda?: boolean; status?: string } = {}): RespostaRoteiro => {
  const { moda = false, status = 'rascunho', ...resto } = extra;
  return {
    roteiro: { id: 'R1', familia_id: 'F1', versao: 1, status, moda, conteudo: { categoria: 'c', contrato: 'contrato', missoes: [missao(1), missao(2, { headline: 'um dois três quatro cinco seis' })] } },
    erros: [], erros_por_missao: {}, ciencia_pendente: [], fatos: [], ...resto,
  };
};

function abrir(mlItemId = 'MLB1', isAdmin = true) {
  return render(<DialogGaleria mlItemId={mlItemId} codigoPai="0001" open onOpenChange={() => undefined} isAdmin={isAdmin} />);
}
async function irParaRoteiro() {
  await userEvent.click(await screen.findByRole('tab', { name: /Roteiro/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.montarFicha.mockResolvedValue(ok(ficha([])));
  api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda: false, familia_id: 'F1' }));
  api.listarImagens.mockResolvedValue(ok({ roteiro: null, unit_cents: 0, imagens: [] }));
  api.estadoAplicacoes.mockResolvedValue(ok({ aplicacoes: [] }));
});

describe('DialogGaleria — aplicar', () => {
  it('com roteiro aprovado o passo 4 lê o estado pelo ml_item_id da linha e, sem admin, não deixa preparar', async () => {
    api.lerRoteiro.mockResolvedValue(ok({ ...resposta({ status: 'aprovado' }), moda: false, familia_id: 'F1' }));
    abrir('MLB-B', false);
    await userEvent.click(await screen.findByRole('tab', { name: /4\. Aplicar/ }));
    await waitFor(() => expect(api.estadoAplicacoes).toHaveBeenCalledWith('MLB-B'));
    expect(screen.getByRole('button', { name: 'Preparar' })).toBeDisabled();
  });

  it('sem roteiro aprovado não há passo Aplicar', async () => {
    abrir();
    await screen.findByRole('tab', { name: /Roteiro/ });
    expect(screen.queryByRole('tab', { name: /Aplicar/ })).not.toBeInTheDocument();
  });
});

describe('DialogGaleria — identidade', () => {
  it('linhas split da mesma família mandam ml_item_id diferentes', async () => {
    const a = abrir('MLB-A');
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledWith('MLB-A'));
    a.unmount();
    abrir('MLB-B');
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledWith('MLB-B'));
  });

  it('criar roteiro manda ml_item_id da linha e a família vigente devolvida pela edge', async () => {
    api.criarRoteiro.mockResolvedValue(ok(resposta()));
    abrir('MLB-B');
    await irParaRoteiro();
    await userEvent.click(screen.getByRole('button', { name: 'Criar roteiro' }));
    expect(api.criarRoteiro).toHaveBeenCalledWith('MLB-B', 'F1');
  });
});

describe('DialogGaleria — abertura sequencial', () => {
  it('chama montar e só depois ler; o selo reflete o estado pós-montar (desatualizado)', async () => {
    const ordem: string[] = [];
    let liberarMontar: (v: unknown) => void = () => undefined;
    api.montarFicha.mockImplementation(() => { ordem.push('montar'); return new Promise((r) => { liberarMontar = r; }); });
    api.lerRoteiro.mockImplementation(async () => {
      ordem.push('ler');
      return ok({ ...resposta({ status: 'desatualizado' }), moda: false, familia_id: 'F1' });
    });
    abrir();
    await waitFor(() => expect(ordem).toEqual(['montar']));
    expect(api.lerRoteiro).not.toHaveBeenCalled();
    liberarMontar(ok(ficha([])));
    await waitFor(() => expect(ordem).toEqual(['montar', 'ler']));
    await irParaRoteiro();
    expect(await screen.findByText('desatualizado')).toBeInTheDocument();
  });

  it('com ler pendente não há "Criar roteiro"; com ler → roteiro null ele aparece', async () => {
    let liberarLer: (v: unknown) => void = () => undefined;
    api.lerRoteiro.mockReturnValue(new Promise((r) => { liberarLer = r; }));
    abrir();
    await waitFor(() => expect(api.lerRoteiro).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: /Roteiro/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar roteiro' })).toBeNull();
    liberarLer(ok({ roteiro: null, moda: false, familia_id: 'F1' }));
    await irParaRoteiro();
    expect(screen.getByRole('button', { name: 'Criar roteiro' })).toBeInTheDocument();
  });

  it('ler falhou: não oferece "Criar roteiro" (não sabe se há roteiro vigente)', async () => {
    api.lerRoteiro.mockResolvedValue(falha(500, 'falha_interna'));
    abrir();
    await irParaRoteiro();
    expect(screen.queryByRole('button', { name: 'Criar roteiro' })).toBeNull();
  });

  it('troca de mlItemId no meio da abertura descarta a resposta antiga', async () => {
    const lentas: Record<string, (v: unknown) => void> = {};
    api.montarFicha.mockImplementation((id: string) => new Promise((r) => { lentas[id] = r; }));
    const { rerender } = abrir('MLB-A');
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledWith('MLB-A'));
    rerender(<DialogGaleria mlItemId="MLB-B" codigoPai="0002" open onOpenChange={() => undefined} isAdmin />);
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledWith('MLB-B'));
    lentas['MLB-B'](ok(ficha([fato('nome', 'CONFIRMADO', 'Produto B')])));
    expect(await screen.findByText('Produto B')).toBeInTheDocument();
    lentas['MLB-A'](ok(ficha([fato('nome', 'CONFIRMADO', 'Produto A')])));
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

describe('Passo fatos', () => {
  const divergente = (foto: { origem: 'referencia' | 'ml'; ref: string; url?: string }) => ficha([fato('atributo:FABRIC', 'DIVERGENTE', 'Poliéster', {
    etiqueta: { legivel: true, valor: 'Algodão', foto, caixa: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
  })]);
  const carregarRecorte = async (evento: 'load' | 'error') => {
    const recorte = await screen.findByRole('img', { name: 'Recorte da etiqueta' });
    fireEvent[evento](recorte.querySelector('img')!);
  };

  it('DIVERGENTE: com o recorte carregado, "Usar o da etiqueta" vem pré-selecionado; aplicar corrige o cadastro', async () => {
    api.montarFicha.mockResolvedValue(ok(divergente({ origem: 'referencia', ref: 'o/a.jpg', url: 'https://x.test/a.jpg' })));
    api.corrigirCadastro.mockResolvedValue(ok(ficha([fato('atributo:FABRIC', 'CONFIRMADO', 'Algodão')])));
    abrir();
    await carregarRecorte('load');
    expect(await screen.findByRole('radio', { name: /Usar o da etiqueta/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(api.corrigirCadastro).toHaveBeenCalledWith('MLB1', 'F1', 'atributo:FABRIC', 'Algodão');
  });

  it('DIVERGENTE de foto do ML usa a URL que veio da edge (a tela não monta URL de CDN)', async () => {
    api.montarFicha.mockResolvedValue(ok(divergente({ origem: 'ml', ref: 'PIC1', url: 'https://http2.mlstatic.com/D_NQ_X-O.jpg' })));
    abrir();
    const recorte = await screen.findByRole('img', { name: 'Recorte da etiqueta' });
    expect(recorte.querySelector('img')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_NQ_X-O.jpg');
    expect(recorte.style.backgroundImage).toContain('https://http2.mlstatic.com/D_NQ_X-O.jpg');
  });

  it('DIVERGENTE com a imagem do recorte falhando: nada pré-selecionado, etiqueta desabilitada e Aplicar bloqueado', async () => {
    api.montarFicha.mockResolvedValue(ok(divergente({ origem: 'referencia', ref: 'o/a.jpg', url: 'https://x.test/quebrada.jpg' })));
    abrir();
    await carregarRecorte('error');
    expect(await screen.findByText(/Não foi possível mostrar o recorte/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Usar o da etiqueta/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Usar o da etiqueta/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Manter o do cadastro/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    expect(api.corrigirCadastro).not.toHaveBeenCalled();
  });

  it('DIVERGENTE sem URL de recorte (edge não resolveu): nada pré-selecionado', async () => {
    api.montarFicha.mockResolvedValue(ok(divergente({ origem: 'ml', ref: 'PIC1' })));
    abrir();
    expect(await screen.findByText(/Não foi possível mostrar o recorte/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Usar o da etiqueta/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
  });

  it('DIVERGENTE de campo não corrigível (ORIGEM) só permite manter o cadastro', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('ORIGEM', 'DIVERGENTE', 'NACIONAL', { etiqueta: { legivel: true, valor: 'China' } })])));
    api.manterCadastro.mockResolvedValue(ok(ficha([])));
    abrir();
    expect(await screen.findByRole('radio', { name: /Usar o da etiqueta/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(api.manterCadastro).toHaveBeenCalledWith('MLB1', 'F1', 'ORIGEM');
  });

  it('SUGERIDO tem Confirmar e Descartar', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('atributo:SLEEVE', 'SUGERIDO', 'Curta')])));
    api.confirmarFato.mockResolvedValue(ok(ficha([fato('atributo:SLEEVE', 'SUGERIDO', 'Curta')])));
    api.descartarFato.mockResolvedValue(ok(ficha([])));
    abrir();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(api.confirmarFato).toHaveBeenCalledWith('MLB1', 'F1', 'atributo:SLEEVE');
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(api.descartarFato).toHaveBeenCalledWith('MLB1', 'F1', 'atributo:SLEEVE');
  });

  it('VARIA_POR_TAMANHO é explicado', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([fato('largura_cm', 'VARIA_POR_TAMANHO', '20')])));
    abrir();
    expect(await screen.findByText(/muda de um tamanho para outro/)).toBeInTheDocument();
  });

  it('roteiro desatualizado avisa já na ficha', async () => {
    api.montarFicha.mockResolvedValue(ok(ficha([], { roteiro_desatualizado: true })));
    abrir();
    expect(await screen.findByRole('alert')).toHaveTextContent(/desatualizado/);
  });

  it.each([[false], [null]])('sem Moda confirmada (moda=%s) o envio de costas nunca aparece', async (moda) => {
    api.lerRoteiro.mockResolvedValue(ok({ roteiro: null, moda, familia_id: 'F1' }));
    abrir();
    await screen.findByText('Ficha verdade');
    expect(screen.queryByRole('button', { name: 'Enviar foto de costas' })).toBeNull();
  });

  it('com Moda confirmada pela edge o envio aparece só depois da resposta', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    api.lerRoteiro.mockReturnValue(new Promise((ok2) => { resolver = ok2; }));
    abrir();
    await screen.findByRole('tab', { name: /Roteiro/ }).catch(() => undefined);
    expect(screen.queryByRole('button', { name: 'Enviar foto de costas' })).toBeNull();
    resolver(ok({ roteiro: null, moda: true, familia_id: 'F1' }));
    expect(await screen.findByRole('button', { name: 'Enviar foto de costas' })).toBeInTheDocument();
  });
});

describe('Passo roteiro', () => {
  async function comRoteiro(r: RespostaRoteiro) {
    api.criarRoteiro.mockResolvedValue(ok(r));
    abrir();
    await irParaRoteiro();
    await userEvent.click(screen.getByRole('button', { name: 'Criar roteiro' }));
    await screen.findByText(/Versão 1/);
  }

  it('contador de palavras fica vermelho acima do limite', async () => {
    await comRoteiro(resposta());
    const m2 = screen.getByRole('region', { name: 'Missão 2' });
    expect(within(m2).getByLabelText('6 de 5 palavras')).toHaveAttribute('data-excedeu', 'true');
  });

  it('erros_por_missao aparecem na missão, que segue ativa; aprovar fica desabilitado', async () => {
    await comRoteiro(resposta({ erros: ['Missão 2: título longo'], erros_por_missao: { '2': ['Missão 2: título longo'] } }));
    const m2 = screen.getByRole('region', { name: 'Missão 2' });
    expect(within(m2).getByRole('alert')).toHaveTextContent('título longo');
    expect(within(m2).getByRole('checkbox', { name: 'Missão 2 ativa' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Aprovar roteiro' })).toBeDisabled();
  });

  it('ciência obrigatória quando há fato não conferido citado; aprovar manda os campos', async () => {
    await comRoteiro(resposta({ ciencia_pendente: ['atributo:FABRIC'] }));
    api.aprovarRoteiro.mockResolvedValue(ok({ roteiro_id: 'R1', status: 'aprovado', fatos_hash: 'h' }));
    const aprovar = screen.getByRole('button', { name: 'Aprovar roteiro' });
    expect(aprovar).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ciente: atributo:FABRIC' }));
    expect(aprovar).toBeEnabled();
    await userEvent.click(aprovar);
    expect(api.aprovarRoteiro).toHaveBeenCalledWith('MLB1', 'F1', 'R1', ['atributo:FABRIC']);
  });

  it('texto que estoura a largura da caixa bloqueia a aprovação do roteiro, com o motivo na missão', async () => {
    const longa = 'Aplicação extraordinária instantânea profissionalíssima garantida';
    const r = resposta();
    r.roteiro.conteudo.missoes[1] = missao(2, { headline: longa });
    await comRoteiro(r);
    const b = screen.getByRole('button', { name: 'Aprovar roteiro' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', expect.stringMatching(/Missão 2/));
    expect(within(screen.getByRole('region', { name: 'Missão 2' })).getByRole('alert')).toHaveTextContent(/Título não cabe/);
  });

  it('missão inativa ou Moda não bloqueiam por largura', async () => {
    const longa = 'Aplicação extraordinária instantânea profissionalíssima garantida';
    const r = resposta({ moda: true });
    r.roteiro.conteudo.missoes[1] = missao(2, { headline: longa });
    await comRoteiro(r);
    expect(screen.getByRole('button', { name: 'Aprovar roteiro' })).toBeEnabled();
  });

  it('não-admin não aprova (com motivo no title)', async () => {
    api.criarRoteiro.mockResolvedValue(ok(resposta()));
    abrir('MLB1', false);
    await irParaRoteiro();
    await userEvent.click(screen.getByRole('button', { name: 'Criar roteiro' }));
    const b = await screen.findByRole('button', { name: 'Aprovar roteiro' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', expect.stringMatching(/administradores/));
  });

  it('roteiro desatualizado mostra aviso', async () => {
    await comRoteiro(resposta({ status: 'desatualizado' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/desatualizado/);
  });

  it.each([
    ['categoria_mudou', /categoria do anúncio mudou/],
    ['conteudo_mudou', /alterado em outra aba/],
  ])('409 %s mostra mensagem clara e recarrega a ficha', async (codigo, msg) => {
    await comRoteiro(resposta());
    api.aprovarRoteiro.mockResolvedValue(falha(409, codigo as string));
    api.montarFicha.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar roteiro' }));
    expect(await screen.findByText(msg as RegExp)).toBeInTheDocument();
    await waitFor(() => expect(api.montarFicha).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Criar roteiro' })).toBeInTheDocument();
  });

  it('503 categoria_indisponivel no aprovar: mensagem clara e o roteiro continua na tela', async () => {
    await comRoteiro(resposta());
    api.aprovarRoteiro.mockResolvedValue(falha(503, 'categoria_indisponivel'));
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar roteiro' }));
    expect(await screen.findByText(/ler a categoria no Mercado Livre/)).toBeInTheDocument();
    expect(screen.getByText(/Versão 1/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Missão 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar roteiro' })).toBeEnabled();
  });

  it('ao abrir, mostra o roteiro existente devolvido por ler (sem precisar criar)', async () => {
    api.lerRoteiro.mockResolvedValue(ok({ ...resposta({ status: 'aprovado' }), moda: false, familia_id: 'F1' }));
    abrir();
    await irParaRoteiro();
    expect(await screen.findByText(/Versão 1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar roteiro' })).toBeNull();
  });

  it('spec que não bate pode ser removida da missão', async () => {
    const r = resposta();
    r.roteiro.conteudo.missoes[1].specs = [{ campo: 'largura_cm', rotulo: 'Largura', valor: '99 cm' }];
    await comRoteiro(r);
    const m2 = screen.getByRole('region', { name: 'Missão 2' });
    await userEvent.click(within(m2).getByRole('button', { name: 'Remover spec Largura' }));
    expect(within(m2).queryByText('99 cm')).toBeNull();
    api.salvarRoteiro.mockResolvedValue(ok(resposta()));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(api.salvarRoteiro.mock.calls[0][3].missoes[1].specs).toEqual([]);
  });
});

describe('BotaoGaleria (gate do módulo imagem_ia)', () => {
  it('sem o módulo não há botão; com o módulo há, e abre com o mlItemId da linha', async () => {
    const abrirGaleria = vi.fn();
    const { rerender } = render(<BotaoGaleria temImagemIA={false} mlItemId="MLB9" codigoPai="0009" onAbrir={abrirGaleria} />);
    expect(screen.queryByRole('button', { name: 'Galeria IA' })).toBeNull();
    rerender(<BotaoGaleria temImagemIA mlItemId="MLB9" codigoPai="0009" onAbrir={abrirGaleria} />);
    await userEvent.click(screen.getByRole('button', { name: 'Galeria IA' }));
    expect(abrirGaleria).toHaveBeenCalledWith({ mlItemId: 'MLB9', codigoPai: '0009' });
  });
});
