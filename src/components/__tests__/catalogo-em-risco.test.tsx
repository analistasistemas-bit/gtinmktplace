import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CatalogoEmRisco } from '../catalogo-em-risco';
import type { AnuncioEmRisco } from '@/lib/catalogo-risco';

const item = (over: Partial<AnuncioEmRisco> = {}): AnuncioEmRisco => ({
  mlItemId: 'MLB100', titulo: 'Fita Cetim N.3', qtdSemFicha: 4,
  motivoPredominante: 'pendente', url: 'https://www.mercadolivre.com.br/produzir/catalogo/MLB100', ...over,
});

describe('CatalogoEmRisco', () => {
  it('lista título, contagem, motivo e link direto para o catálogo do ML', () => {
    render(<CatalogoEmRisco itens={[
      item(),
      item({ mlItemId: 'MLB200', titulo: 'Linha Xik', motivoPredominante: 'sem_produto', qtdSemFicha: 1 }),
      item({ mlItemId: 'MLB300', titulo: 'Fita Gorgurão', motivoPredominante: 'ficha_divergente' }),
      item({ mlItemId: 'MLB400', titulo: 'Barbante', motivoPredominante: 'nao_elegivel' }),
    ]} />);
    expect(screen.getByText(/4 anúncios com variações sem ficha/i)).toBeInTheDocument();
    expect(screen.getByText('Fita Cetim N.3')).toBeInTheDocument();
    expect(screen.getByText('Elegibilidade não resolvida')).toBeInTheDocument();
    expect(screen.getByText('Sem ficha no catálogo')).toBeInTheDocument();
    expect(screen.getByText('Ficha divergente')).toBeInTheDocument();
    expect(screen.getByText('Não elegível')).toBeInTheDocument();
    const link = screen.getAllByRole('link', { name: /resolver no ml/i })[0];
    expect(link).toHaveAttribute('href', 'https://www.mercadolivre.com.br/produzir/catalogo/MLB100');
  });

  it('sem itens, não renderiza nada', () => {
    const { container } = render(<CatalogoEmRisco itens={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
