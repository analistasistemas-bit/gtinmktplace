import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Revisao from '@/pages/Revisao';

function renderRevisao() {
  return render(
    <MemoryRouter initialEntries={['/revisao/lote-42']}>
      <Routes>
        <Route path="/revisao/:loteId" element={<Revisao />} />
      </Routes>
    </MemoryRouter>
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
