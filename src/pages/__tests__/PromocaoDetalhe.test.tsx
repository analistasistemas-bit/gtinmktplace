import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // Título aparece na linha da tabela desktop e no cartão da lista mobile (jsdom não aplica a media query, os dois layouts existem no DOM).
    expect(screen.getAllByText('Anúncio teste').length).toBeGreaterThan(0);
    expect(screen.getByText('10%')).toBeTruthy();
  });

  it('mostra líquido e markup no cartão mobile e abre o sheet ao clicar', async () => {
    const user = userEvent.setup();
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();

    const lista = within(screen.getByTestId('lista-mobile'));
    expect(lista.getByText('R$ 32,00')).toBeTruthy();
    expect(lista.getByText('+60%')).toBeTruthy();

    await user.click(lista.getByRole('button'));
    expect(within(screen.getByRole('dialog')).getByText('Anúncio teste')).toBeTruthy();
  });

  it('não mostra seleção quando o tipo da campanha não é DEAL/SMART', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo: 'LIGHTNING' }], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();

    expect(screen.queryByLabelText('Selecionar MLB1')).not.toBeInTheDocument();
  });

  it('seleciona convidado e participando em abas diferentes e abre o preview de Aderir', async () => {
    const user = userEvent.setup();
    const participando = { ...item, ml_item_id: 'MLB2', status: 'started', titulo: 'Anúncio participando' } as ItemPromocao;
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item, participando], isLoading: false } as never);

    renderDetalhe();
    const tabela = within(screen.getByRole('region', { name: 'Tabela de dados' }));

    await user.click(tabela.getByLabelText('Selecionar MLB1'));
    await user.click(screen.getByRole('tab', { name: 'Participando' }));
    await user.click(tabela.getByLabelText('Selecionar MLB2'));

    expect(screen.getByRole('button', { name: 'Aderir 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aderir 1' }));
    expect(within(screen.getByRole('dialog')).getByText('Aderir à Campanha teste')).toBeTruthy();
  });
});
