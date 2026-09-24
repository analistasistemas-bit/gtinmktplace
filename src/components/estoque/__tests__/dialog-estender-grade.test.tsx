// Task 7 (ADR-0166 2026-09-24c): "Adicionar à grade" — estende a matriz de um produto de grade
// JÁ PUBLICADO. Cobre os cenários do brief (Step 4): células travadas na matriz, geração de
// células novas, gate de Salvar (estoque/foto), payload da edge, erro 400 e o teto de 60.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DialogEstenderGrade } from '../dialog-estender-grade';
import { QK } from '@/lib/queries';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const invokeMock = vi.fn();
const familiaPublicadaMock = vi.fn();
const familiaCanonicaMock = vi.fn();
const variacoesCanonicasMock = vi.fn();
const famRowsMock = vi.fn();
const tiposProdutoMock = vi.fn(() => ({ data: ['roupa', 'calcado'] as string[] | undefined, isError: false }));
// Achado da revisão (rodada 1): as duas consultas de `familias` podem falhar. `null` (default) =
// sucesso; um Error aqui faz `fetchFamiliaPublicada`/`fetchFamiliaCanonicaId` relançar, e o
// `useQuery` correspondente entra em `isError`.
const familiaPublicadaErroMock = vi.fn<() => Error | null>(() => null);
const familiaCanonicaErroMock = vi.fn<() => Error | null>(() => null);

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (table: string) => {
      if (table !== 'familias') throw new Error(`tabela inesperada no mock: ${table}`);
      return {
        select: (colunas: string) => ({
          eq: () => ({
            // fetchFamiliaPublicada: .eq().not().order().limit()
            not: () => ({
              order: () => ({
                limit: () => Promise.resolve(familiaPublicadaErroMock()
                  ? { data: null, error: familiaPublicadaErroMock() }
                  : { data: familiaPublicadaMock(), error: null }),
              }),
            }),
            // fetchFamiliaCanonicaId: .eq().order().limit() — só 'id' na seleção.
            order: () => ({
              limit: () => Promise.resolve(colunas === 'id' && familiaCanonicaErroMock()
                ? { data: null, error: familiaCanonicaErroMock() }
                : { data: colunas === 'id' ? familiaCanonicaMock() : [], error: null }),
            }),
          }),
        }),
      };
    },
  },
}));

vi.mock('@/stores/support-store', () => ({
  effectiveOrgId: () => 'org-1', canWrite: () => true,
  useSupportStore: { getState: () => ({ context: null }) },
}));
vi.mock('@/hooks/useUploadLote', () => ({ storageOwnerForUpload: () => 'owner-1' }));
vi.mock('@/lib/storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage')>()),
  uploadFile: (_bucket: string, path: string) => Promise.resolve(path),
}));
vi.mock('@/lib/estoque-update-status', async (orig) => ({
  ...(await orig<typeof import('@/lib/estoque-update-status')>()),
  fetchFamiliasNaoPublicadas: () => Promise.resolve(famRowsMock()),
}));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchVariacoesProduto: () => Promise.resolve(variacoesCanonicasMock()),
}));
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({
  useTiposProdutoHabilitados: () => tiposProdutoMock(),
}));

const produto: ProdutoEstoqueResumo = {
  codigoPai: '00000009', nomePai: 'Camiseta Básica', descricaoPai: null,
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Fábrica X', unidade: 'UN', origem: 'nacional',
  mlItemId: 'MLB999', criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20, qtdSkus: 3, skuUnico: null,
  gtins: [], codigos: ['00000001', '00000002', '00000003'], cores: ['Preto', 'Azul'], nomes: [],
  temTamanho: true,
};

// Base: Preto·P (12, com foto), Preto·M (8, com foto), Azul·P (0, SEM foto) — mesma composição
// do fixture do miolo (estender-grade.test.ts). Tipo inferido: roupa (P/M ∈ TAMANHOS_ROUPA).
function variacaoBase(over: Partial<{
  codigo: string; cor: string; tamanho: string; estoque: number; temFoto: boolean; excluida: boolean;
}>) {
  return {
    codigo: over.codigo ?? '00000001',
    cor: over.cor ?? 'Preto',
    tamanho: over.tamanho ?? 'P',
    estoque: over.estoque ?? 0,
    imagem_path: over.temFoto === false ? null : 'algum/path.jpg',
    ml_picture_id: null,
    peso_gramas: 100, altura_cm: 5, largura_cm: 5, comprimento_cm: 5,
    custo: 12.5, preco: 29.9,
    excluida_da_publicacao: over.excluida ?? false,
  };
}

const SKUS_BASE = [
  variacaoBase({ codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true }),
  variacaoBase({ codigo: '00000002', cor: 'Preto', tamanho: 'M', estoque: 8, temFoto: true }),
  variacaoBase({ codigo: '00000003', cor: 'Azul', tamanho: 'P', estoque: 0, temFoto: false }),
];

// Uma só cor publicada (Preto·P/Preto·M) — sem "buraco" no cartesiano dos eixos fixos, então
// marcar um tamanho novo cria EXATAMENTE uma célula nova. Usado pelos testes de gate/salvar, que
// querem uma única linha nova para isolar a asserção (o teste da matriz, mais abaixo, é quem
// cobre o caso de duas cores fixas simultâneas).
const SKUS_UMA_COR = [
  variacaoBase({ codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true }),
  variacaoBase({ codigo: '00000002', cor: 'Preto', tamanho: 'M', estoque: 8, temFoto: true }),
];

function renderDialog(opts: {
  onFechar?: () => void; onNaoEhGrade?: () => void; qc?: QueryClient;
} = {}) {
  const qc = opts.qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = opts.onFechar ?? vi.fn();
  const onNaoEhGrade = opts.onNaoEhGrade ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <DialogEstenderGrade produto={produto} aberto onFechar={onFechar} onNaoEhGrade={onNaoEhGrade} />
    </QueryClientProvider>,
  );
  return { onFechar, onNaoEhGrade, qc };
}

beforeEach(() => {
  invokeMock.mockReset();
  familiaPublicadaMock.mockReset();
  familiaCanonicaMock.mockReset();
  variacoesCanonicasMock.mockReset();
  famRowsMock.mockReset();
  familiaPublicadaErroMock.mockReset();
  familiaCanonicaErroMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.error).mockReset();
  tiposProdutoMock.mockReturnValue({ data: ['roupa', 'calcado'], isError: false });
  famRowsMock.mockReturnValue([]);
  variacoesCanonicasMock.mockReturnValue([]);
  familiaCanonicaMock.mockReturnValue([{ id: 'fam-canonica-1' }]);
  familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: SKUS_BASE }]);
  familiaPublicadaErroMock.mockReturnValue(null);
  familiaCanonicaErroMock.mockReturnValue(null);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((f: File) => `blob:${f.name}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

const BOTAO_SALVAR = () => screen.getByRole('button', { name: /Salvar|Enviando…/ });

describe('DialogEstenderGrade — matriz com SKUs travados', () => {
  it('mostra Preto·P (12) e Preto·M (8) travados; checkbox Preto fixo e desabilitado', async () => {
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.getByTitle('Preto · M: já publicado, 8 em estoque')).toBeInTheDocument();
    const checkboxPreto = screen.getByRole('checkbox', { name: 'Preto' });
    expect(checkboxPreto).toBeChecked();
    expect(checkboxPreto).toBeDisabled();
  });

  it('SKU excluído aparece travado com rótulo "fora do anúncio"', async () => {
    // Azul·M: eixo já fixo dos dois lados (M vem de Preto·M, Azul vem de Azul·P) — a excluída
    // aparece na matriz sem depender de nenhuma seleção do operador.
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: 'unissex',
      variacoes: [...SKUS_BASE, variacaoBase({ codigo: '00000004', cor: 'Azul', tamanho: 'M', estoque: 3, temFoto: true, excluida: true })],
    }]);
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.getByTitle('Azul · M: fora do anúncio')).toBeInTheDocument();
  });

  it('marcar tamanho G cria Preto·G e Azul·G editáveis; marcar cor nova cria as 3 células novas', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');

    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Preto · G')).toBeInTheDocument());
    expect(screen.getByLabelText('Estoque inicial de Azul · G')).toBeInTheDocument();

    // Verde não está em CORES_POPULARES — entra pelo campo de texto livre ("Nova cor"), mesmo
    // caminho de dialog-cadastro-grade.tsx.
    await user.type(screen.getByLabelText('Nova cor'), 'Verde');
    await user.click(screen.getByRole('button', { name: /Adicionar cor/ }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Verde · P')).toBeInTheDocument());
    expect(screen.getByLabelText('Estoque inicial de Verde · M')).toBeInTheDocument();
    expect(screen.getByLabelText('Estoque inicial de Verde · G')).toBeInTheDocument();
  });
});

describe('DialogEstenderGrade — cor repetida em outra grafia', () => {
  it('"PRETO" com Preto publicado não entra na grade (mesma chave de cor da edge)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.type(screen.getByLabelText('Nova cor'), 'PRETO');
    await user.click(screen.getByRole('button', { name: /Adicionar cor/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A cor "PRETO" já existe nesta grade.'));
    expect(screen.queryByLabelText('Estoque inicial de PRETO · P')).not.toBeInTheDocument();
  });
});

describe('DialogEstenderGrade — cor que só existe em SKU excluído', () => {
  const comVermelhoExcluido = () => familiaPublicadaMock.mockReturnValue([{
    id: 'fam-pub-1', genero: 'unissex',
    variacoes: [...SKUS_UMA_COR, variacaoBase({ codigo: '00000009', cor: 'Vermelho', tamanho: 'P', estoque: 0, temFoto: true, excluida: true })],
  }]);
  it('readicionar "Vermelho" (mesma grafia) é aceito: Vermelho·P travada, M/G editáveis', async () => {
    comVermelhoExcluido();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.click(screen.getByRole('checkbox', { name: 'Vermelho' }));
    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Vermelho · M')).toBeInTheDocument());
    expect(screen.getByLabelText('Estoque inicial de Vermelho · G')).toBeInTheDocument();
    expect(screen.getByTitle('Vermelho · P: fora do anúncio')).toBeInTheDocument();
    expect(screen.queryByLabelText('Estoque inicial de Vermelho · P')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
  it('"vermelho" (grafia diferente) no mesmo cenário é recusado', async () => {
    comVermelhoExcluido();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.type(screen.getByLabelText('Nova cor'), 'vermelho');
    await user.click(screen.getByRole('button', { name: /Adicionar cor/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A cor "vermelho" já existe nesta grade.'));
    expect(screen.queryByLabelText('Estoque inicial de vermelho · M')).not.toBeInTheDocument();
  });
});

describe('DialogEstenderGrade — gate de Salvar', () => {
  // Uma só cor publicada (SKUS_UMA_COR): marcar G cria EXATAMENTE uma célula nova (Preto·G),
  // que herda foto de Preto — isola a asserção de estoque sem depender de outra cor.
  beforeEach(() => {
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: SKUS_UMA_COR }]);
  });

  it('trava enquanto uma célula nova tem estoque vazio/0', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Preto · G')).toBeInTheDocument());
    // Preto·G herda foto de Preto (fotoHerdavel), então só falta o estoque.
    expect(BOTAO_SALVAR()).toBeDisabled();
  });

  it('trava enquanto uma cor NOVA sem foto herdável não recebeu foto própria', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.type(screen.getByLabelText('Nova cor'), 'Verde');
    await user.click(screen.getByRole('button', { name: /Adicionar cor/ }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Verde · P')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Estoque inicial de Verde · P'), '3');
    await user.type(screen.getByLabelText('Estoque inicial de Verde · M'), '3');
    // Verde é cor nova, sem nenhum SKU existente — sem enviar foto própria da cor, trava.
    expect(BOTAO_SALVAR()).toBeDisabled();
    // Achado da validação de UI: a foto da cor nova é OBRIGATÓRIA (é exatamente o que trava o
    // Salvar acima) — o rótulo não pode dizer "(opcional)".
    expect(screen.queryByText('(opcional)')).not.toBeInTheDocument();
    await user.upload(
      screen.getByLabelText('Foto da cor Verde'),
      new File(['a'], 'verde.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(BOTAO_SALVAR()).not.toBeDisabled());
  });
});

describe('DialogEstenderGrade — salvar', () => {
  beforeEach(() => {
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: SKUS_UMA_COR }]);
  });

  async function prepararLinhaValida(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Preto · G')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Estoque inicial de Preto · G'), '3');
  }

  it('chama a edge com o payload correto (sem codigo) e marca variacoesRecemAdicionadas', async () => {
    invokeMock.mockResolvedValue({
      data: { loteId: 'lote-1', familiaId: 'fam-nova-1', publicacaoOk: true, falhasEstoque: [], codigos: ['00000010'] },
      error: null,
    });
    const user = userEvent.setup();
    const { qc } = renderDialog();
    await prepararLinhaValida(user);
    await waitFor(() => expect(BOTAO_SALVAR()).not.toBeDisabled());

    await user.click(BOTAO_SALVAR());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    const [nome, opts] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(nome).toBe('adicionar-variacoes-familia');
    expect(opts.body.familia_id).toBe('fam-canonica-1');
    expect(typeof opts.body.chave).toBe('string');
    const variacoes = opts.body.variacoes as Array<Record<string, unknown>>;
    expect(variacoes).toHaveLength(1);
    expect(variacoes[0]).toMatchObject({
      nome: 'Preto', tamanho: 'G', estoqueInicial: 3, fotoDeCodigo: '00000001',
    });
    expect(variacoes[0]).not.toHaveProperty('codigo');
    expect(variacoes[0]).not.toHaveProperty('imagemPath');

    await waitFor(() => expect(qc.getQueryData(QK.variacoesRecemAdicionadas(produto.codigoPai))).toEqual(['00000010']));
  });

  it('erro 400 da edge com `erros` mostra a mensagem no toast', async () => {
    const resposta = new Response(JSON.stringify({ erros: [{ campo: 'variacoes[0].tamanho', mensagem: 'Tamanho inválido.' }] }), { status: 400 });
    invokeMock.mockResolvedValue({ data: null, error: { context: resposta, message: 'Edge Function returned a non-2xx status code' } });
    const user = userEvent.setup();
    renderDialog();
    await prepararLinhaValida(user);
    await waitFor(() => expect(BOTAO_SALVAR()).not.toBeDisabled());

    await user.click(BOTAO_SALVAR());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Tamanho inválido.')));
  });
});

describe('DialogEstenderGrade — teto de 60 e preenchimento em massa', () => {
  // Achado da revisão (rodada 1): TAMANHOS_ROUPA só tem 4 valores (P/M/G/GG) — 6 cores × 4 = 24,
  // nunca 30. Números reais no nome: 24 publicadas + 1 cor nova (4 células) = 28 ≤ 60 → permitido.
  it('6 cores × 4 tamanhos publicadas (24) + 1 cor nova (28) permitido', async () => {
    const cores6 = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
    const tamanhos4 = ['P', 'M', 'G', 'GG'];
    const publicadas24 = cores6.flatMap((c, ci) => tamanhos4.map((t, ti) => variacaoBase({
      codigo: String(ci * 10 + ti + 1).padStart(8, '0'), cor: c, tamanho: t, estoque: 1, temFoto: true,
    })));
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: publicadas24 }]);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('C1 · P: já publicado, 1 em estoque');
    // 24 células publicadas, 28 com a cor nova — ainda longe do teto de 60. "Adicionar cor" livre
    // (o botão só some do teto quando o campo "Nova cor" também tem texto — sem isso ele SEMPRE
    // trava, vazio).
    await user.type(screen.getByLabelText('Nova cor'), 'Verde');
    expect(screen.getByRole('button', { name: /Adicionar cor/ })).not.toBeDisabled();
  });

  // 15 cores × 4 tamanhos = 60 (o teto exato) — qualquer cor a mais estoura. Mesmo tipo (roupa)
  // do teste acima, só a contagem de cores muda — não precisa de calçado pra alcançar 60.
  it('15 cores × 4 tamanhos publicadas (60, o teto exato) bloqueia cor nova', async () => {
    const cores15 = Array.from({ length: 15 }, (_, i) => `Cor${i}`);
    const tamanhos4 = ['P', 'M', 'G', 'GG'];
    const publicadas60 = cores15.flatMap((c, ci) => tamanhos4.map((t, ti) => variacaoBase({
      codigo: String(ci * 10 + ti + 1).padStart(8, '0'), cor: c, tamanho: t, estoque: 1, temFoto: true,
    })));
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: publicadas60 }]);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Cor0 · P: já publicado, 1 em estoque');
    await user.type(screen.getByLabelText('Nova cor'), 'Verde');
    expect(screen.getByRole('button', { name: /Adicionar cor/ })).toBeDisabled();
  });

  // Achado da revisão final: a edge conta TODAS as existentes (`vivas.length + novas`). 14 cores ×
  // 4 = 56 células + 3 excluídas com cor fora dos eixos = 59; uma cor a mais daria 63 na edge
  // (60 no cartesiano visível, que antes passava).
  it('56 células + 3 excluídas fora dos eixos (59) bloqueia cor nova — conta igual à edge', async () => {
    const cores14 = Array.from({ length: 14 }, (_, i) => `Cor${i}`);
    const tamanhos4 = ['P', 'M', 'G', 'GG'];
    const publicadas56 = cores14.flatMap((c, ci) => tamanhos4.map((t, ti) => variacaoBase({
      codigo: String(ci * 10 + ti + 1).padStart(8, '0'), cor: c, tamanho: t, estoque: 1, temFoto: true,
    })));
    const excluidas3 = ['P', 'M', 'G'].map((t, i) => variacaoBase({
      codigo: String(900 + i).padStart(8, '0'), cor: 'Fora', tamanho: t, estoque: 0, temFoto: true, excluida: true,
    }));
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: [...publicadas56, ...excluidas3] }]);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Cor0 · P: já publicado, 1 em estoque');
    await user.type(screen.getByLabelText('Nova cor'), 'Verde');
    expect(screen.getByRole('button', { name: /Adicionar cor/ })).toBeDisabled();
  });

  it('12 cores × 5 (60) bloqueia "Adicionar cor"', async () => {
    // TAMANHOS_ROUPA só tem 4 valores (P/M/G/GG) — 12×5 só é alcançável em calçado, que tem
    // numeração de sobra (33 a 46 + frações).
    const cores12 = Array.from({ length: 12 }, (_, i) => `Cor${i}`);
    const numeracoes5 = ['38', '39', '40', '41', '42'];
    const publicadas60 = cores12.flatMap((c, ci) => numeracoes5.map((t, ti) => variacaoBase({
      codigo: String(ci * 10 + ti + 1).padStart(8, '0'), cor: c, tamanho: t, estoque: 1, temFoto: true,
    })));
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: publicadas60 }]);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Cor0 · 38: já publicado, 1 em estoque');
    await user.type(screen.getByLabelText('Nova cor'), 'Verde');
    expect(screen.getByRole('button', { name: /Adicionar cor/ })).toBeDisabled();
  });

  it('preencher em massa "toda a grade" só alcança células novas — payload não inclui as travadas', async () => {
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'unissex', variacoes: SKUS_UMA_COR }]);
    invokeMock.mockResolvedValue({
      data: { loteId: 'lote-1', familiaId: 'fam-nova-1', publicacaoOk: true, falhasEstoque: [], codigos: ['00000010'] },
      error: null,
    });
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Preto · G')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Preencher em massa' }));
    await user.type(screen.getByLabelText('Valor'), '7');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Preto · G')).toHaveValue('7'));
    // As travadas continuam mostrando o valor publicado, imutável — o preenchimento em massa
    // nunca as alcança (elas nem existem em `linhas`, só em `bloqueadas`).
    expect(screen.getByTitle('Preto · P: já publicado, 12 em estoque')).toBeInTheDocument();
    expect(screen.getByTitle('Preto · M: já publicado, 8 em estoque')).toBeInTheDocument();

    await waitFor(() => expect(BOTAO_SALVAR()).not.toBeDisabled());
    await user.click(BOTAO_SALVAR());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    const [, opts] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    const variacoes = opts.body.variacoes as Array<Record<string, unknown>>;
    expect(variacoes).toHaveLength(1);
    expect(variacoes[0]).toMatchObject({ estoqueInicial: 7 });
  });
});

describe('DialogEstenderGrade — testes do brief ausentes (achado da revisão, rodada 1)', () => {
  // (a) Só a família PUBLICADA trava célula. A CANÔNICA (usada só pra extrair `familia_id`, uma
  // tentativa de UPDATE que falhou pode ter Preto·P + Preto·M) nunca é lida pra travar nada — o
  // dialog não consulta as variações dela. Preto·P (publicada) trava; Preto·M (só existiria numa
  // canônica hipotética) é célula nova comum assim que o operador marca o tamanho.
  it('SKU que só existiria numa família CANÔNICA (tentativa falha) fica editável — só a publicada trava', async () => {
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: 'unissex',
      variacoes: [variacaoBase({ codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true })],
    }]);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await waitFor(() => expect(screen.getByLabelText('Estoque inicial de Preto · M')).toBeInTheDocument());
    expect(screen.getByTitle('Preto · P: já publicado, 12 em estoque')).toBeInTheDocument();
  });

  // (b) Preto·P incluído + Azul·38 excluído: excluída não traz eixo — nem coluna 38 (nem é
  // NUMERACOES_CALCADO válida pro tipo roupa já resolvido), nem linha Azul, nem célula nova com 38.
  it('roupa com Preto·P incluído e Azul·38 excluído — nenhuma coluna 38, nenhuma linha Azul', async () => {
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: 'unissex',
      variacoes: [
        variacaoBase({ codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true }),
        variacaoBase({ codigo: '00000002', cor: 'Azul', tamanho: '38', estoque: 3, temFoto: true, excluida: true }),
      ],
    }]);
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.queryByRole('checkbox', { name: '38' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/de Azul/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/38/)).not.toBeInTheDocument();
  });

  // (c) O SKU com numeração de calçado é o EXCLUÍDO — só ele, sozinho, decidiria o tipo errado
  // (misto) se contasse. Como só as incluídas decidem, o tipo resolve 'roupa' e os 4 chips
  // aparecem liberados (sem o aviso de "tipos incompatíveis").
  it('numeração de calçado só num SKU excluído — tipo resolve roupa, chips P/M/G/GG liberados', async () => {
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: 'unissex',
      variacoes: [
        variacaoBase({ codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true }),
        variacaoBase({ codigo: '00000002', cor: 'Preto', tamanho: '38', estoque: 3, temFoto: true, excluida: true }),
      ],
    }]);
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.queryByText(/não pertencem a um único tipo/)).not.toBeInTheDocument();
    for (const t of ['P', 'M', 'G', 'GG']) {
      expect(screen.getByRole('checkbox', { name: t })).toBeInTheDocument();
    }
  });

  // (d) Org com os DOIS tipos habilitados, mas a família publicada é uma jaqueta (roupa) — os
  // tamanhos oferecidos vêm só do TIPO DA FAMÍLIA, nunca da união dos tipos da org (Codex r5 #2).
  it('org com roupa+calçado habilitados e jaqueta publicada — nenhum chip de numeração de calçado', async () => {
    tiposProdutoMock.mockReturnValue({ data: ['roupa', 'calcado'], isError: false });
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.queryByRole('checkbox', { name: '38' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '40' })).not.toBeInTheDocument();
  });

  // (e) Incluídas misturando tamanho e ausência de tamanho → `classificarFamilia` devolve
  // 'mista' — aviso específico de bloqueio (diferente do "tipos incompatíveis"), Salvar travado.
  it("família 'mista' (incluídas com e sem tamanho) mostra aviso de bloqueio e trava Salvar", async () => {
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: 'unissex',
      variacoes: [
        variacaoBase({ codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true }),
        variacaoBase({ codigo: '00000002', cor: 'Azul', tamanho: '', estoque: 5, temFoto: true }),
      ],
    }]);
    renderDialog();
    await screen.findByText('SKUs publicados com e sem tamanho — fale com o suporte.');
    expect(BOTAO_SALVAR()).toBeDisabled();
  });
});

describe('DialogEstenderGrade — numeração de calçado sem guia de tamanhos', () => {
  const skuCalcado = [variacaoBase({ codigo: '00000001', cor: 'Preto', tamanho: '38', estoque: 5, temFoto: true })];

  it('feminino: numeração 45 vem bloqueada (sem guia de tamanhos)', async () => {
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'feminino', variacoes: skuCalcado }]);
    renderDialog();
    await screen.findByTitle('Preto · 38: já publicado, 5 em estoque');
    expect(screen.getByRole('checkbox', { name: '45' })).toBeDisabled();
  });

  it('masculino: numeração 45 fica liberada', async () => {
    familiaPublicadaMock.mockReturnValue([{ id: 'fam-pub-1', genero: 'masculino', variacoes: skuCalcado }]);
    renderDialog();
    await screen.findByTitle('Preto · 38: já publicado, 5 em estoque');
    expect(screen.getByRole('checkbox', { name: '45' })).not.toBeDisabled();
  });
});

describe('DialogEstenderGrade — bloqueios de tipo', () => {
  it('tipo desativado na org mostra aviso e trava Salvar', async () => {
    tiposProdutoMock.mockReturnValue({ data: ['calcado'], isError: false }); // sem 'roupa'
    const user = userEvent.setup();
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.getByText(/O tipo Roupa está desativado nesta organização/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    expect(BOTAO_SALVAR()).toBeDisabled();
  });

  it('erro ao carregar tipos da org mostra aviso', async () => {
    tiposProdutoMock.mockReturnValue({ data: undefined, isError: true });
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.getByText(/Não foi possível confirmar os tipos de produto/)).toBeInTheDocument();
    expect(BOTAO_SALVAR()).toBeDisabled();
  });
});

describe('DialogEstenderGrade — família publicada simples (fallback do roteador)', () => {
  it('classe simples chama onNaoEhGrade e não renderiza a matriz', async () => {
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: null,
      variacoes: [variacaoBase({ codigo: '00000001', cor: 'Único', tamanho: '', estoque: 5, temFoto: true })],
    }]);
    const onNaoEhGrade = vi.fn();
    renderDialog({ onNaoEhGrade });
    await waitFor(() => expect(onNaoEhGrade).toHaveBeenCalled());
  });
});

describe('DialogEstenderGrade — erro de consulta (rodada 1)', () => {
  it('erro em fetchFamiliaPublicada mostra aviso (não fica preso no skeleton)', async () => {
    familiaPublicadaErroMock.mockReturnValue(new Error('falha de rede'));
    renderDialog();
    await screen.findByText('Não foi possível carregar o produto. Tente de novo.');
    expect(screen.queryByTitle(/já publicado/)).not.toBeInTheDocument();
  });

  it('erro em fetchFamiliaCanonicaId mostra aviso; a matriz (publicada) continua visível', async () => {
    familiaCanonicaErroMock.mockReturnValue(new Error('falha de rede'));
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.getByText('Não foi possível carregar o produto. Tente de novo.')).toBeInTheDocument();
    expect(BOTAO_SALVAR()).toBeDisabled();
  });

  it('familiaPublicada === null (resumo defasado, produto ainda não publicado) chama onNaoEhGrade', async () => {
    familiaPublicadaMock.mockReturnValue([]); // .limit() sem linha nenhuma → null
    const onNaoEhGrade = vi.fn();
    renderDialog({ onNaoEhGrade });
    await waitFor(() => expect(onNaoEhGrade).toHaveBeenCalled());
  });
});

describe('DialogEstenderGrade — família em voo', () => {
  it('mostra o banner e trava o Salvar', async () => {
    famRowsMock.mockReturnValue([
      { codigo_pai: produto.codigoPai, status: 'processando', operacao: 'UPDATE', criado_em: '2026-09-01T10:00:00Z' },
    ]);
    renderDialog();
    await screen.findByTitle('Preto · P: já publicado, 12 em estoque');
    expect(screen.getByText(/Já existe uma atualização em andamento/)).toBeInTheDocument();
    expect(BOTAO_SALVAR()).toBeDisabled();
  });
});
