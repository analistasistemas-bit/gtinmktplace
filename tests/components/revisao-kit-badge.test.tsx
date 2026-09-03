import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Familia } from '@/lib/tipos-dominio';

// ADR-0151 D-2: badge "N kits aguardando a publicação deste produto" no card da base — sempre
// visível na lista (sem precisar expandir a família), porque o kit não ganha card próprio na
// Revisão no caminho feliz (Decisão 4).
// M-0: a badge lê de 1 query por página (fetchKitsDosProdutos), não mais de 1 por família.

const VAR_OK = {
  codigo: '00010001', cor: 'Vermelho', corHex: '#dc2626', corOrigem: 'descricao' as const,
  corEditadaPeloOperador: false, preco: 1, precoPublicacao: 1, estoque: 10,
  gtin: null, fotoPath: 'u/l/001.jpeg', excluidaDaPublicacao: false,
};

const FAMILIA_BASE: Familia = {
  id: 'a',
  loteId: 'lote-42',
  codigoPai: '1001',
  titulo: 'Linha Vermelha',
  descricao: '',
  operacao: 'CREATE',
  estrategiaPreco: 'PROPRIO',
  estrategiaMotivo: '',
  concorrencia: 'sem',
  concorrenciaVendedores: 0,
  concorrenciaPrecoMin: null,
  analiseMercado: null,
  tipoAviamento: 'linha',
  categoriaMlId: 'MLB270273',
  precoMin: 1,
  precoMax: 1,
  precoAbaixo20pc: false,
  capaStoragePath: null,
  variacoes: [VAR_OK],
  status: 'pronto',
  tokensInput: null,
  tokensOutput: null,
  custoCentavos: null,
  tituloEditadoPeloOperador: false,
  descricaoEditadaPeloOperador: false,
  variacoesSemCor: 0,
  concorrenciaCategoriaId: null,
} as Familia;

vi.mock('@/hooks/useFamilias', () => ({
  useFamilias: () => ({ data: [FAMILIA_BASE], isLoading: false, error: null, isSuccess: true }),
}));

const fetchKitsDosProdutosMock = vi.fn();
vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>();
  return {
    ...actual,
    fetchKitsDosProdutos: (codigosPai: string[]) => fetchKitsDosProdutosMock(codigosPai),
  };
});

vi.mock('@/lib/publicar', () => ({
  publicarFamilias: vi.fn().mockResolvedValue({ enfileiradas: 1 }),
  setVariacaoExcluida: vi.fn(),
}));

import Revisao from '@/pages/Revisao';

function renderRevisao() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/revisao/lote-42']}>
        <Routes>
          <Route path="/revisao/:loteId" element={<Revisao />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Revisao — badge "kits aguardando" (ADR-0151 D-2, M-0)', () => {
  it('aparece SEM expandir a família quando há kits pronto e sem ml_item_id', async () => {
    fetchKitsDosProdutosMock.mockResolvedValue([
      { familiaId: 'k1', codigoPai: 'K1', kitBaseCodigoPai: '1001', multiplicador: 2, status: 'pronto', mlPermalink: null, mlItemId: null, criadoEm: '2026-01-01' },
      { familiaId: 'k2', codigoPai: 'K2', kitBaseCodigoPai: '1001', multiplicador: 3, status: 'pronto', mlPermalink: null, mlItemId: null, criadoEm: '2026-01-01' },
    ]);
    renderRevisao();
    const badge = await screen.findByText(/2 kits aguardando a publicação deste produto/);
    expect(badge).toBeInTheDocument();
    expect(badge.closest('[title]')).toHaveAttribute(
      'title',
      'Os kits só vão ao ar depois que este produto for publicado com sucesso. Se a publicação falhar, nenhum kit é publicado.',
    );
  });

  it('singular quando só 1 kit aguardando', async () => {
    fetchKitsDosProdutosMock.mockResolvedValue([
      { familiaId: 'k1', codigoPai: 'K1', kitBaseCodigoPai: '1001', multiplicador: 2, status: 'pronto', mlPermalink: null, mlItemId: null, criadoEm: '2026-01-01' },
    ]);
    renderRevisao();
    expect(await screen.findByText(/1 kit aguardando a publicação deste produto/)).toBeInTheDocument();
  });

  it('some quando o kit já foi publicado (tem ml_item_id)', async () => {
    fetchKitsDosProdutosMock.mockResolvedValue([
      { familiaId: 'k1', codigoPai: 'K1', kitBaseCodigoPai: '1001', multiplicador: 2, status: 'publicado', mlPermalink: 'https://x', mlItemId: 'MLB1', criadoEm: '2026-01-01' },
    ]);
    renderRevisao();
    await screen.findByText('Linha Vermelha');
    expect(screen.queryByText(/aguardando a publicação/)).not.toBeInTheDocument();
  });

  it('não aparece quando não há kits vinculados', async () => {
    fetchKitsDosProdutosMock.mockResolvedValue([]);
    renderRevisao();
    await screen.findByText('Linha Vermelha');
    expect(screen.queryByText(/aguardando a publicação/)).not.toBeInTheDocument();
  });
});
