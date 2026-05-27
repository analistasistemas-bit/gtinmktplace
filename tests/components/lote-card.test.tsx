import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoteCard } from '@/components/lote-card';
import type { Lote } from '@/lib/tipos-dominio';

const LOTE_REVISAO: Lote = {
  id: 'lote-42',
  numero: 42,
  criadoEm: '2026-05-25T14:32:00.000Z',
  status: 'revisao',
  totalFamilias: 50,
  totalPublicadas: 0,
  totalErros: 0,
};

const LOTE_CONCLUIDO: Lote = {
  id: 'lote-41',
  numero: 41,
  criadoEm: '2026-05-24T10:15:00.000Z',
  status: 'concluido',
  totalFamilias: 12,
  totalPublicadas: 11,
  totalErros: 1,
};

function renderCard(lote: Lote) {
  return render(
    <MemoryRouter>
      <LoteCard lote={lote} />
    </MemoryRouter>
  );
}

describe('LoteCard', () => {
  it('mostra número, data, status e contadores', () => {
    renderCard(LOTE_REVISAO);
    expect(screen.getByText(/Lote #42/i)).toBeInTheDocument();
    expect(screen.getByText(/50 famílias/i)).toBeInTheDocument();
    expect(screen.getByText(/em revis/i)).toBeInTheDocument();
  });

  it('mostra contagem de publicadas e erros quando concluído', () => {
    renderCard(LOTE_CONCLUIDO);
    expect(screen.getByText(/11 publicadas/i)).toBeInTheDocument();
    expect(screen.getByText(/1 erro/i)).toBeInTheDocument();
  });

  it('link aponta para /revisao quando status=revisao', () => {
    renderCard(LOTE_REVISAO);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/revisao/lote-42');
  });

  it('link aponta para /relatorio quando status=concluido', () => {
    renderCard(LOTE_CONCLUIDO);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/relatorio/lote-41');
  });
});
