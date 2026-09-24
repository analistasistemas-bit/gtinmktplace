import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltrosMovimentos } from '../filtros-movimentos';

// jsdom não implementa scrollIntoView, e o Radix Select chama ao mover o item ativo pelo
// teclado (mesmo stub de barra-filtros-estoque.test.tsx).
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

const props = {
  grupos: [], onGrupos: vi.fn(),
  periodo: null, onPeriodo: vi.fn(),
  codigo: null, onCodigo: vi.fn(),
};

describe('FiltrosMovimentos — seletor de variação', () => {
  // ADR-0166 (Task 3) INV-1: sem tamanho, a opção mantém exatamente o rótulo de hoje.
  it('sem tamanho, a opção tem exatamente o rótulo de hoje', async () => {
    const user = userEvent.setup();
    render(<FiltrosMovimentos {...props} variacoes={[
      { codigo: '18760903', cor: 'Preto' },
      { codigo: '26706073', cor: 'Azul' },
    ]} />);
    screen.getByRole('combobox', { name: 'Variação' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: '18760903 · Preto' })).toBeInTheDocument();
  });

  it('com tamanho, a opção ganha o sufixo " · <tamanho>"', async () => {
    const user = userEvent.setup();
    render(<FiltrosMovimentos {...props} variacoes={[
      { codigo: '09200001', cor: 'Preto', nome: 'Preto', tamanho: 'M' },
      { codigo: '26706073', cor: 'Azul' },
    ]} />);
    screen.getByRole('combobox', { name: 'Variação' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: '09200001 · Preto · M' })).toBeInTheDocument();
  });
});
