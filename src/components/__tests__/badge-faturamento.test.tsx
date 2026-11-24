import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BadgeFaturamento } from '../sidebar';

const posvenda = vi.fn(() => 0);
const perguntas = vi.fn(() => ({ count: 0, isError: false }));
vi.mock('@/hooks/usePosvenda', () => ({ usePosvendaBadge: () => posvenda() }));
vi.mock('@/hooks/usePerguntas', () => ({ usePerguntasNaoRespondidas: () => perguntas() }));

afterEach(cleanup);

describe('BadgeFaturamento', () => {
  it('sem pendência não renderiza', () => {
    const { container } = render(<BadgeFaturamento />);
    expect(container.innerHTML).toBe('');
  });

  it('soma pós-venda + perguntas e pulsa', () => {
    posvenda.mockReturnValue(1);
    perguntas.mockReturnValue({ count: 2, isError: false });
    render(<BadgeFaturamento />);
    const badge = screen.getByLabelText('3 pendências no Faturamento');
    expect(badge.textContent).toBe('3');
    expect(badge.querySelector('.motion-safe\\:animate-ping')).toBeTruthy();
  });

  it('acima de 99 mostra 99+', () => {
    posvenda.mockReturnValue(100);
    perguntas.mockReturnValue({ count: 0, isError: false });
    render(<BadgeFaturamento />);
    expect(screen.getByText('99+')).toBeTruthy();
  });
});
