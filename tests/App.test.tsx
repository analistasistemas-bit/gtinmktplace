import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

describe('App routing', () => {
  it('renderiza Dashboard na rota /', () => {
    renderRoute('/');
    expect(screen.getByRole('heading', { name: /lotes recentes/i })).toBeInTheDocument();
  });

  it('renderiza NovoLote na rota /novo-lote', () => {
    renderRoute('/novo-lote');
    expect(screen.getByRole('heading', { name: /novo lote/i })).toBeInTheDocument();
  });

  it('renderiza Progresso na rota /progresso/:loteId', () => {
    renderRoute('/progresso/lote-37');
    expect(screen.getByRole('heading', { name: /processando/i })).toBeInTheDocument();
  });

  it('renderiza Revisao na rota /revisao/:loteId', () => {
    renderRoute('/revisao/lote-42');
    expect(screen.getByRole('heading', { name: /revis/i })).toBeInTheDocument();
  });

  it('renderiza Relatorio na rota /relatorio/:loteId', () => {
    renderRoute('/relatorio/lote-41');
    expect(screen.getByRole('heading', { name: /relat/i })).toBeInTheDocument();
  });

  it('renderiza Configuracoes na rota /configuracoes', () => {
    renderRoute('/configuracoes');
    expect(screen.getByRole('heading', { name: /config/i })).toBeInTheDocument();
  });

  it('renderiza NotFound em rota desconhecida', () => {
    renderRoute('/rota-que-nao-existe');
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.getByText(/Página não encontrada/i)).toBeInTheDocument();
  });

  it('renderiza Sidebar dentro das rotas com shell', () => {
    renderRoute('/');
    expect(screen.getByText('EAN2Marketplace')).toBeInTheDocument();
    expect(screen.getByText('diego@empresa')).toBeInTheDocument();
  });
});
