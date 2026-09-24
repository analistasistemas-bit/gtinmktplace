import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PromocaoDetalhe from '../PromocaoDetalhe';
import { useItensPromocao, usePromocoes } from '@/hooks/usePromocoes';
import type { ItemPromocao, Promocao } from '@/lib/promocoes';

vi.mock('@/hooks/usePromocoes', () => ({
  usePromocoes: vi.fn(), useItensPromocao: vi.fn(),
}));

const promo = {
  promocao_id: 'P1', tipo: 'DEAL', nome: 'Campanha teste', status: 'started',
  inicio: null, fim: null, prazo_adesao: null, beneficios: null, contagem: null,
  erro: null, itens_sincronizados_em: null, rodada_em_curso: null,
} as Promocao;

const item = {
  ml_item_id: 'MLB1', status: 'candidate',
  preco_original: 100, preco_promo: 80, preco_min: 70, preco_max: 90,
  preco_sugerido: null, preco_avaliado: 80, ml_pct: 10, estoque_min: null,
  titulo: 'Anúncio teste', thumbnail: null, permalink: null,
  pior_semaforo: 'verde',
  projecao: [{ variation_id: 1, cor: 'Azul', sku: null, custo: 20, piso: 30, origem: 'nacional', liquido: 32, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null }],
} as unknown as ItemPromocao;

function renderDetalhe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/promocoes/P1']}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/promocoes/:promocaoId" element={<PromocaoDetalhe />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PromocaoDetalhe', () => {
  it('renderiza a tabela com uma linha que tem ml_pct sem erro de TooltipProvider', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();

    expect(screen.getAllByText('Campanha teste').length).toBeGreaterThan(0);
    expect(screen.getByText('Anúncio teste')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
  });
});
