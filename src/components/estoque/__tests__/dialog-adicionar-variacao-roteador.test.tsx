// Task 7 (ADR-0166 2026-09-24c): o roteador decide pelo DADO do produto (`temTamanho`), nunca
// pelo tipo habilitado na org — o dialog de grade é quem confirma a palavra final (lê a família
// PUBLICADA) e devolve o controle ao fluxo antigo via `onNaoEhGrade` quando ela não é grade.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogAdicionarVariacaoRoteador } from '../dialog-adicionar-variacao-roteador';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const familiaPublicadaMock = vi.fn();
const familiaCanonicaMock = vi.fn();
const familiaPrefillMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    // Um mock genérico serve às DUAS telas: DialogEstenderGrade (2 consultas 'familias' — a
    // publicada com embed de variações e o id canônico) e DialogAdicionarVariacao (prefill). A
    // consulta certa é resolvida pela FORMA do payload de retorno de cada mock.
    from: (table: string) => {
      if (table !== 'familias') throw new Error(`tabela inesperada no mock: ${table}`);
      return {
        select: (colunas: string) => ({
          eq: () => ({
            not: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: familiaPublicadaMock(), error: null }) }),
            }),
            order: () => ({
              limit: () => Promise.resolve({
                data: colunas === 'id'
                  ? familiaCanonicaMock()
                  : familiaPrefillMock(),
                error: null,
              }),
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
vi.mock('@/lib/estoque-update-status', async (orig) => ({
  ...(await orig<typeof import('@/lib/estoque-update-status')>()),
  fetchFamiliasNaoPublicadas: () => Promise.resolve([]),
}));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchVariacoesProduto: () => Promise.resolve([]),
}));
const tiposProdutoMock = vi.fn(() => ({ data: [] as string[], isError: false }));
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({
  useTiposProdutoHabilitados: () => tiposProdutoMock(),
}));

const produtoSimples: ProdutoEstoqueResumo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: null,
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: 'MLB123', criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20, qtdSkus: 1, skuUnico: '00000005',
  gtins: ['4005800241901'], codigos: ['00000005'], cores: ['incolor'], nomes: [], temTamanho: false,
};
const produtoGrade: ProdutoEstoqueResumo = { ...produtoSimples, codigoPai: '00000009', temTamanho: true };

function renderRoteador(produto: ProdutoEstoqueResumo | null, onFechar = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DialogAdicionarVariacaoRoteador produto={produto} onFechar={onFechar} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  familiaPublicadaMock.mockReset();
  familiaCanonicaMock.mockReset();
  familiaPrefillMock.mockReset();
  familiaCanonicaMock.mockReturnValue([{ id: 'fam-canonica-1' }]);
  familiaPrefillMock.mockReturnValue([{ id: 'fam-canonica-1', variacoes: [] }]);
});

afterEach(() => cleanup());

describe('DialogAdicionarVariacaoRoteador', () => {
  it('produto sem tamanho abre DialogAdicionarVariacao na hora, sem consulta de grade', async () => {
    renderRoteador(produtoSimples);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Adicionar variação' })).toBeInTheDocument());
    expect(await screen.findByLabelText('Código (SKU) da variação 1')).toBeInTheDocument();
    expect(familiaPublicadaMock).not.toHaveBeenCalled();
  });

  it('produto com tamanho abre DialogEstenderGrade, mesmo com tipos_produto_da_org vazio', async () => {
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: 'unissex',
      variacoes: [{
        codigo: '00000010', cor: 'Preto', tamanho: 'P', estoque: 5,
        imagem_path: 'x.jpg', ml_picture_id: null,
        peso_gramas: 100, altura_cm: 5, largura_cm: 5, comprimento_cm: 5,
        custo: 10, preco: 20, excluida_da_publicacao: false,
      }],
    }]);
    renderRoteador(produtoGrade);
    await waitFor(() => expect(screen.getByText('Adicionar à grade')).toBeInTheDocument());
    // O dialog antigo (campo "Código") nunca chega a montar — o roteador não renderiza os dois
    // ao mesmo tempo.
    expect(screen.queryByLabelText(/Código \(SKU\)/)).not.toBeInTheDocument();
  });

  it('produto null não abre nenhum dialog', () => {
    renderRoteador(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // Codex r4 #1: a família publicada é 'simples' (nenhuma variação com tamanho) — o resumo
  // (temTamanho: true) divergiu dela, e o dialog de grade devolve o controle ao fluxo antigo em
  // vez de travar o operador numa tela vazia.
  it('família publicada simples (resumo divergente) cai para DialogAdicionarVariacao', async () => {
    familiaPublicadaMock.mockReturnValue([{
      id: 'fam-pub-1', genero: null,
      variacoes: [{
        codigo: '00000010', cor: 'Único', tamanho: null, estoque: 5,
        imagem_path: 'x.jpg', ml_picture_id: null,
        peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null,
        custo: null, preco: 20, excluida_da_publicacao: false,
      }],
    }]);
    renderRoteador(produtoGrade);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Adicionar variação' })).toBeInTheDocument());
    expect(await screen.findByLabelText('Código (SKU) da variação 1')).toBeInTheDocument();
  });
});
