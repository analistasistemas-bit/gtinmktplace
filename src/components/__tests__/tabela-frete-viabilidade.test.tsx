import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@/hooks/useTabelaFreteML', () => ({
  useTabelaFreteML: () => ({ data: m.data, isLoading: false, isError: false }),
  isTabelaFrete: (r: unknown) => !!r && typeof r === 'object' && 'celulas' in r,
}));

const { TabelaFreteViabilidade } = await import('../tabela-frete-viabilidade');

const base = {
  faixasPreco: [{ label: 'A', itemPrice: 15 }, { label: 'B', itemPrice: 35 }],
  faixasPeso: [{ label: 'Até 300 g', pesoGramas: 300, dimensoes: {} }],
};

describe('TabelaFreteViabilidade', () => {
  beforeEach(() => { m.data = { ...base, celulas: [[null, 0]] }; });

  it('null → "—" com title; 0 → R$ 0,00', () => {
    render(<TabelaFreteViabilidade categoriaMlId="MLB1" analiseConcluida />);
    const traco = screen.getByText('—', { selector: 'td' });
    expect(traco).toHaveAttribute('title', 'Indisponível no Mercado Livre');
    expect(screen.getByText(/R\$\s0,00/, { selector: 'td' })).toBeInTheDocument();
  });

  it('legenda nova', () => {
    render(<TabelaFreteViabilidade categoriaMlId="MLB1" analiseConcluida />);
    expect(screen.getByText(/R\$ 0,00 = comprador paga o frete · — = o Mercado Livre não respondeu esta faixa/)).toBeInTheDocument();
  });

  it('sem ME2: análise pede refazer; calculadora não', () => {
    m.data = { indisponivel: true, motivo: 'sem_me2' };
    const { unmount } = render(<TabelaFreteViabilidade categoriaMlId="MLB1" analiseConcluida />);
    expect(screen.getByText(/refaça a análise/)).toBeInTheDocument();
    unmount();
    render(<TabelaFreteViabilidade categoriaMlId="MLB1" analiseConcluida contexto="calculadora" />);
    expect(screen.queryByText(/refaça a análise/)).toBeNull();
    expect(screen.getByText(/Mercado Envios/)).toBeInTheDocument();
  });
});
