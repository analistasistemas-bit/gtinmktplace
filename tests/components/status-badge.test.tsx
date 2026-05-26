import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it('renderiza label correto para status revisao', () => {
    render(<StatusBadge status="revisao" />);
    expect(screen.getByText(/revis/i)).toBeInTheDocument();
  });

  it('renderiza label correto para status concluido', () => {
    render(<StatusBadge status="concluido" />);
    expect(screen.getByText(/conclu/i)).toBeInTheDocument();
  });

  it('renderiza label correto para status erro', () => {
    render(<StatusBadge status="erro" />);
    expect(screen.getByText(/erro/i)).toBeInTheDocument();
  });
});
