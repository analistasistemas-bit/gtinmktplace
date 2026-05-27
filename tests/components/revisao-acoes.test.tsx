import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Familia } from '@/lib/tipos-dominio';

// Mocka useFamilias para devolver direto um array de famílias, evitando
// dependência de QueryClient/Supabase neste teste de UI.
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
    precoMin: 1,
    precoMax: 1,
    precoAbaixo20pc: false,
    variacoes: [],
    status: 'pronto',
  },
  {
    id: 'b',
    loteId: 'lote-42',
    codigoPai: '1002',
    titulo: 'Botão Azul',
    descricao: '',
    operacao: 'UPDATE',
    estrategiaPreco: 'COMPETITIVO',
    estrategiaMotivo: '',
    concorrencia: 'alta',
    precoMin: 1,
    precoMax: 1,
    precoAbaixo20pc: true,
    variacoes: [],
    status: 'pronto',
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
    expect(screen.queryByRole('button', { name: /aprovar/i })).not.toBeInTheDocument();
  });

  it('footer aparece com botões Aprovar e Rejeitar ao selecionar', () => {
    renderRevisao();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(screen.getByRole('button', { name: /aprovar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rejeitar/i })).toBeInTheDocument();
  });

  it('clicar em Aprovar limpa seleção', () => {
    renderRevisao();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText(/2 selecionada/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /aprovar/i }));
    expect(screen.queryByText(/2 selecionada/i)).not.toBeInTheDocument();
  });
});
