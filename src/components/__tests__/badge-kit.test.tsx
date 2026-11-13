import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BadgesKit } from '../badge-kit';
import type { MarcaKit } from '@/lib/publicados';

afterEach(cleanup);

const marca = (p: Partial<MarcaKit> = {}): MarcaKit => ({
  tipo: 'vinculado',
  papel: 'tem',
  estado: 'normal',
  rotulo: 'Tem kit vinculado',
  detalhe: 'Kit vinculado: Kit 4 (ativo)',
  ...p,
});

describe('BadgesKit', () => {
  it('o nome acessível é o rótulo visível', () => {
    render(<BadgesKit marcas={[marca()]} />);
    expect(screen.getByRole('button', { name: 'Tem kit vinculado' })).toHaveTextContent('Tem kit vinculado');
  });

  it('o detalhe fica acessível no tooltip ao focar o botão', async () => {
    render(<BadgesKit marcas={[marca()]} />);
    act(() => screen.getByRole('button', { name: 'Tem kit vinculado' }).focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Kit vinculado: Kit 4 (ativo)');
  });

  it('uma badge por marca, na ordem recebida', () => {
    render(
      <BadgesKit
        marcas={[
          marca({ rotulo: 'A' }),
          marca({ tipo: 'variacao', rotulo: 'B' }),
          marca({ tipo: 'virtual', rotulo: 'C' }),
        ]}
      />,
    );
    const botoes = screen.getAllByRole('button');
    expect(botoes).toHaveLength(3);
    expect(botoes.map((b) => b.textContent)).toEqual(['A', 'B', 'C']);
  });

  it('papel "e" de kit virtual não renderiza', () => {
    const { container } = render(<BadgesKit marcas={[marca({ tipo: 'virtual', papel: 'e' })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('clicar na badge não propaga para a linha', () => {
    const aoClicarLinha = vi.fn();
    render(
      // Simula a linha clicável da tabela; o handler só existe para provar que o clique não sobe.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={aoClicarLinha}>
        <BadgesKit marcas={[marca()]} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(aoClicarLinha).not.toHaveBeenCalled();
  });

  it('estado falha troca o ícone', () => {
    render(<BadgesKit marcas={[marca({ estado: 'falha' })]} />);
    const botao = screen.getByRole('button');
    expect(botao).toHaveAttribute('data-estado', 'falha');
    expect(botao.querySelector('svg')).toHaveClass('lucide-triangle-alert');
  });

  it('lista vazia não renderiza nada', () => {
    const { container } = render(<BadgesKit marcas={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
