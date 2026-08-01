import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VariacaoEstoqueCard } from '../variacao-estoque-card';
import type { VariacaoComSaldo } from '@/lib/produtos-saldo';

vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));

function variacao(over: Partial<VariacaoComSaldo> = {}): VariacaoComSaldo {
  return {
    codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901',
    estoque: 20, custo: 12, preco: 89.9, pesoGramas: 200,
    alturaCm: 10, larguraCm: 20, comprimentoCm: 30, imagemPath: null, ...over,
  };
}

describe('VariacaoEstoqueCard', () => {
  it('mostra SKU, cor, GTIN e dimensões', () => {
    render(<VariacaoEstoqueCard variacao={variacao()} />);
    expect(screen.getByText('00000005')).toBeInTheDocument();
    expect(screen.getByText('incolor')).toBeInTheDocument();
    expect(screen.getByText(/4005800241901/)).toBeInTheDocument();
    expect(screen.getByText(/200g · 10×20×30cm/)).toBeInTheDocument();
  });

  it('saldo zero recebe aviso de sem estoque', () => {
    render(<VariacaoEstoqueCard variacao={variacao({ estoque: 0 })} />);
    expect(screen.getByText('sem estoque')).toBeInTheDocument();
  });

  // Saldo negativo é bug de ledger, não "acabou o estoque": precisa de rótulo próprio.
  it('saldo negativo recebe rótulo de inconsistência', () => {
    render(<VariacaoEstoqueCard variacao={variacao({ estoque: -3 })} />);
    expect(screen.getByText('saldo inconsistente')).toBeInTheDocument();
  });
});
