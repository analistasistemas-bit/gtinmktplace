import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Familia } from '@/lib/tipos-dominio';

// Mocka useFamilias para devolver direto um array de famílias, evitando
// dependência de QueryClient/Supabase neste teste de UI.
const VAR_OK = {
  codigo: '00010001', cor: 'Vermelho', corHex: '#dc2626', corOrigem: 'descricao' as const,
  corEditadaPeloOperador: false, preco: 1, precoPublicacao: 1, estoque: 10,
  gtin: null, fotoPath: 'u/l/001.jpeg', excluidaDaPublicacao: false,
};

const FAMILIAS_FAKE: Familia[] = [
  {
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
  },
  {
    id: 'b',
    loteId: 'lote-42',
    codigoPai: '1002',
    titulo: 'Botão Azul',
    descricao: '',
    operacao: 'CREATE',
    estrategiaPreco: 'COMPETITIVO',
    estrategiaMotivo: '',
    concorrencia: 'alta',
    concorrenciaVendedores: 5,
    concorrenciaPrecoMin: null,
    analiseMercado: null,
    tipoAviamento: 'botao',
    categoriaMlId: 'MLB270272',
    precoMin: 1,
    precoMax: 1,
    precoAbaixo20pc: true,
    capaStoragePath: null,
    variacoes: [{ ...VAR_OK, codigo: '00010002' }],
    status: 'pronto',
    tokensInput: null,
    tokensOutput: null,
    custoCentavos: null,
    tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0,
    concorrenciaCategoriaId: null,
  },
];

vi.mock('@/hooks/useFamilias', () => ({
  useFamilias: () => ({
    data: FAMILIAS_FAKE,
    isLoading: false,
    error: null,
    isSuccess: true,
  }),
}));

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
    </QueryClientProvider>
  );
}

describe('Revisao — ações em massa', () => {
  it('footer fica oculto quando nenhuma família selecionada', () => {
    renderRevisao();
    expect(screen.queryByRole('button', { name: /publicar/i })).not.toBeInTheDocument();
  });

  it('footer aparece com botão Publicar ao selecionar família publicável', () => {
    renderRevisao();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(screen.getByRole('button', { name: /publicar selecionada/i })).toBeInTheDocument();
  });

  it('clicar em Publicar abre modal com título "Publicar no Mercado Livre"', () => {
    renderRevisao();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /publicar selecionada/i }));
    expect(screen.getByText('Publicar no Mercado Livre')).toBeInTheDocument();
  });
});
