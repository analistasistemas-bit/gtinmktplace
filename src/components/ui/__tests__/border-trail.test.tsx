import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BorderTrail } from '../border-trail';

describe('BorderTrail', () => {
  it('inativo: renderiza filho sem trilha', () => {
    render(
      <BorderTrail active={false}>
        <span>Conteúdo</span>
      </BorderTrail>
    );

    expect(screen.getByText('Conteúdo')).toBeInTheDocument();
    expect(document.querySelector('.border-trail')).not.toBeInTheDocument();
  });

  it('ativo: renderiza filho dentro do wrapper com trilha', () => {
    render(
      <BorderTrail active>
        <span>Conteúdo</span>
      </BorderTrail>
    );

    expect(screen.getByText('Conteúdo')).toBeInTheDocument();
    expect(document.querySelector('.border-trail')).toBeInTheDocument();
    expect(document.querySelector('.border-trail__track')).toBeInTheDocument();
    expect(document.querySelector('.border-trail__track')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.border-trail__fallback')).toBeInTheDocument();
  });

  it('ativo: semântica e acessibilidade preservadas', () => {
    render(
      <BorderTrail active>
        <button type="button">Ação</button>
      </BorderTrail>
    );

    const button = screen.getByRole('button', { name: 'Ação' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Ação');
  });
});
