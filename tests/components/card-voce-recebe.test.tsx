import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardVoceRecebe } from '@/components/card-voce-recebe';

vi.mock('@/hooks/useTarifaML', () => ({
  useTarifaML: () => ({
    data: {
      classico: { comissao: 7.68, percentual: 11.5, fixa: 6.24, recebe: 4.82 },
      premium: { comissao: 8.30, percentual: 16.5, fixa: 6.24, recebe: 4.20 },
    },
    isLoading: false,
    isError: false,
  }),
}));

describe('CardVoceRecebe', () => {
  it('mostra o líquido de Clássico e Premium e o alerta de frete', () => {
    render(<CardVoceRecebe preco={12.5} categoriaMlId="MLB270273" />);
    expect(screen.getByText(/4,82/)).toBeInTheDocument(); // Clássico (maior líquido)
    expect(screen.getByText(/4,20/)).toBeInTheDocument(); // Premium
    expect(screen.getByText(/acima de r\$19.*frete grátis/i)).toBeInTheDocument();
  });

  it('mostra margem (lucro ÷ preço) ao lado do markup (lucro ÷ custo)', () => {
    render(<CardVoceRecebe preco={10} custo={2} categoriaMlId="MLB270273" />);
    // Clássico: lucro 2,82 → markup 141%, margem 28%
    expect(screen.getByText('141%')).toBeInTheDocument();
    expect(screen.getByText('28%')).toBeInTheDocument();
    // Premium: lucro 2,20 → markup 110%, margem 22%
    expect(screen.getByText('110%')).toBeInTheDocument();
    expect(screen.getByText('22%')).toBeInTheDocument();
  });
});
