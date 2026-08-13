import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CatalogoEmRisco } from '../catalogo-em-risco';
import type { AnuncioEmRisco } from '@/lib/catalogo-risco';

vi.mock('@/hooks/useExtensaoCatalogo', () => ({ useExtensaoCatalogo: vi.fn() }));
import { useExtensaoCatalogo } from '@/hooks/useExtensaoCatalogo';

const item = (over: Partial<AnuncioEmRisco> = {}): AnuncioEmRisco => ({
  mlItemId: 'MLB100', titulo: 'Fita Cetim N.3', qtdSemFicha: 4,
  motivoPredominante: 'pendente', url: 'https://www.mercadolivre.com.br/produzir/catalogo/MLB100',
  variacoesRisco: [], vinculos: {}, itemPlano: false, ...over,
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

describe('CatalogoEmRisco — botão da extensão (Fase 3)', () => {
  const anuncio = (over: Partial<AnuncioEmRisco>): AnuncioEmRisco => ({
    mlItemId: 'MLB1', titulo: 'Linha Xik', qtdSemFicha: 2, motivoPredominante: 'sem_produto',
    url: 'https://www.mercadolivre.com.br/produzir/catalogo/MLB1',
    variacoesRisco: ['111'], vinculos: {}, itemPlano: false, ...over,
  });

  it('sem extensão: sem botão (degrada para o card da Fase 1)', () => {
    vi.mocked(useExtensaoCatalogo).mockReturnValue(false);
    render(<CatalogoEmRisco itens={[anuncio({})]} />);
    expect(screen.queryByRole('button', { name: /resolver todos no ml/i })).toBeNull();
  });

  it('com extensão: botão presente e postMessage com o lote (sem item plano)', () => {
    vi.mocked(useExtensaoCatalogo).mockReturnValue(true);
    const post = vi.spyOn(window, 'postMessage');
    render(<CatalogoEmRisco itens={[anuncio({}), anuncio({ mlItemId: 'MLB2', itemPlano: true })]} />);
    fireEvent.click(screen.getByRole('button', { name: /resolver todos no ml/i }));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'publiai:resolver-catalogo',
        lote: [expect.objectContaining({ mlItemId: 'MLB1' })], // item plano ficou de fora
      }),
      window.location.origin,
    );
    post.mockRestore();
  });

  it('com extensão mas só item plano: botão não aparece', () => {
    vi.mocked(useExtensaoCatalogo).mockReturnValue(true);
    render(<CatalogoEmRisco itens={[anuncio({ itemPlano: true })]} />);
    expect(screen.queryByRole('button', { name: /resolver todos no ml/i })).toBeNull();
  });
});
