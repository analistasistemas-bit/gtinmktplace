import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromocaoBaseKit } from '../promocao-base-kit';
import type { PrecoPeca } from '@/lib/kit-preco-avulso';

const fetchMock = vi.fn();
vi.mock('@/lib/kit-variacao-edge', () => ({ fetchPrecoAvulsoKit: (id: string) => fetchMock(id) }));

function renderPromo(ativo = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PromocaoBaseKit familiaBaseId="fam-1" ativo={ativo} /></QueryClientProvider>);
}
const mapa = (p: PrecoPeca) => new Map([['SKU1', p]]);

afterEach(() => { cleanup(); fetchMock.mockReset(); });

describe('PromocaoBaseKit', () => {
  it('mostra promoção ativa e futura da base', async () => {
    fetchMock.mockResolvedValue(mapa({
      normal: 50, promocao: 40, fimPromocao: '2026-11-20T12:00:00Z',
      futuras: [{ tipo: 'DEAL', preco: 35, inicio: '2026-12-01T12:00:00Z', fim: '2026-12-10T12:00:00Z' }],
    }));
    renderPromo();
    expect(await screen.findByText(/Base em promoção: R\$\s*40,00 até 20\/11 \(normal R\$\s*50,00\)/)).toBeInTheDocument();
    expect(screen.getByText('Promoções programadas da base')).toBeInTheDocument();
    expect(screen.getByText(/Produto-base: R\$\s*35,00/)).toBeInTheDocument();
  });

  it('rejeição vira "promoção da base indisponível"', async () => {
    fetchMock.mockRejectedValue(new Error('x'));
    renderPromo();
    expect(await screen.findByText('promoção da base indisponível')).toBeInTheDocument();
  });

  it('futuras_indisponivel vira "promoção da base indisponível"', async () => {
    fetchMock.mockResolvedValue(mapa({ normal: 50, promocao: null, fimPromocao: null, futuras: [], futurasIndisponivel: true }));
    renderPromo();
    expect(await screen.findByText('promoção da base indisponível')).toBeInTheDocument();
  });

  it('promoção ativa + futuras_indisponivel mostra as duas coisas', async () => {
    fetchMock.mockResolvedValue(mapa({ normal: 50, promocao: 40, fimPromocao: null, futuras: [], futurasIndisponivel: true }));
    renderPromo();
    expect(await screen.findByText(/Base em promoção: R\$\s*40,00/)).toBeInTheDocument();
    expect(screen.getByText('promoção da base indisponível')).toBeInTheDocument();
  });

  it('sem promoção não renderiza nada', async () => {
    fetchMock.mockResolvedValue(mapa({ normal: 50, promocao: null, fimPromocao: null, futuras: [] }));
    const { container } = renderPromo();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('inativo (base em Revisão) não chama a edge nem renderiza', () => {
    const { container } = renderPromo(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
