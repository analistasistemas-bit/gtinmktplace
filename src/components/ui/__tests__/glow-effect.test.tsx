import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { GlowEffect } from '../glow-effect';

describe('GlowEffect', () => {
  it('ativo: aura decorativa por trás do filho, sem entrar na árvore de acessibilidade', () => {
    render(<GlowEffect><button type="button">Pulse</button></GlowEffect>);

    expect(screen.getByRole('button', { name: 'Pulse' })).toBeInTheDocument();
    const aura = document.querySelector('.glow-effect__aura');
    expect(aura).toBeInTheDocument();
    expect(aura).toHaveAttribute('aria-hidden', 'true');
  });

  it('inativo: wrapper continua, aura não', () => {
    render(<GlowEffect ativo={false}><span>Conteúdo</span></GlowEffect>);

    // Wrapper sempre presente: alternar o efeito não pode desmontar o filho (perderia foco).
    expect(document.querySelector('.glow-effect')).toBeInTheDocument();
    expect(document.querySelector('.glow-effect__aura')).not.toBeInTheDocument();
    expect(screen.getByText('Conteúdo')).toBeInTheDocument();
  });

  it('forte: variante de intensidade sai na classe, não em estilo inline', () => {
    const { rerender } = render(<GlowEffect><span>x</span></GlowEffect>);
    expect(document.querySelector('.glow-effect')).not.toHaveClass('glow-effect--forte');

    rerender(<GlowEffect forte><span>x</span></GlowEffect>);
    expect(document.querySelector('.glow-effect')).toHaveClass('glow-effect--forte');
  });

  it('radius vira variável CSS, para a aura acompanhar o canto do filho', () => {
    render(<GlowEffect radius={6}><span>x</span></GlowEffect>);
    expect(document.querySelector<HTMLElement>('.glow-effect')?.style
      .getPropertyValue('--glow-effect-radius')).toBe('6px');
  });
});
