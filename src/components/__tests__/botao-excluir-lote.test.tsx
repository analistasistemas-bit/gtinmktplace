import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LotesEmAndamento } from '@/components/dashboard-lotes-andamento';
import type { Lote } from '@/lib/tipos-dominio';

vi.mock('@/hooks/useExcluirLote', () => ({
  useExcluirLote: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const lote = (status: Lote['status']) =>
  ({ id: 'l1', numero: 68, status, totalPublicadas: 0, totalErros: 0 }) as unknown as Lote;

function montar(status: Lote['status']) {
  render(
    <MemoryRouter>
      <LotesEmAndamento lotes={[lote(status)]} />
    </MemoryRouter>,
  );
}

describe('Excluir lote em andamento', () => {
  it('lote em revisão mostra lixeira habilitada', () => {
    montar('revisao');
    expect(screen.getByRole('button', { name: 'Excluir lote' })).toBeEnabled();
  });
  it('lote processando tem lixeira bloqueada', () => {
    montar('processando');
    expect(screen.getByRole('button', { name: /Aguarde/ })).toBeDisabled();
  });
});
