import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Publicados from '@/pages/Publicados';
import type { PublicadoItem } from '@/lib/publicados';

const usePublicadosMock = vi.fn();
const useStatusPublicadosMock = vi.fn();
const useRemoverPublicadoMock = vi.fn();

vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => usePublicadosMock(),
}));

vi.mock('@/hooks/useStatusPublicados', () => ({
  useStatusPublicados: () => useStatusPublicadosMock(),
}));

vi.mock('@/hooks/useRemoverPublicado', () => ({
  useRemoverPublicado: () => useRemoverPublicadoMock(),
}));

function itemBase(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: 'f1',
    codigoPai: '01829149',
    titulo: 'COLA LIQUIDA SILICONE 250ML',
    fornecedor: 'BUFALO',
    tipo: 'cola',
    precoPublicacao: 24.1,
    descricao: 'descricao',
    mlItemId: 'MLB1',
    mlPermalink: 'https://example.com/mlb1',
    publicadoEm: '2026-06-12T12:36:04.408Z',
    status: 'ativo',
    estoque: 87,
    precoAtual: 24.1,
    motivo: null,
    ...over,
  };
}

describe('Publicados', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    usePublicadosMock.mockReturnValue({
      data: [itemBase()],
      isLoading: false,
      error: null,
    });
    useStatusPublicadosMock.mockReturnValue({
      data: { itens: [] },
      isFetching: false,
      refetch: vi.fn(),
    });
    useRemoverPublicadoMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    });
  });

  it('mostra o tipo cola na tabela', () => {
    render(<Publicados />);

    expect(screen.getByRole('cell', { name: 'Cola' })).toBeInTheDocument();
  });

  it('oferece Cola no filtro de tipos', () => {
    render(<Publicados />);

    fireEvent.click(screen.getAllByRole('combobox')[2]);

    expect(screen.getByRole('option', { name: 'Cola' })).toBeInTheDocument();
  });
});
