import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListaParticipando } from '../lista-participando';
import { useParticipacoes, usePromocoes } from '@/hooks/usePromocoes';
import type { Participacao, Promocao } from '@/lib/promocoes';

vi.mock('@/hooks/usePromocoes', () => ({ usePromocoes: vi.fn(), useParticipacoes: vi.fn() }));
const preview = vi.fn();
vi.mock('../preview-operacao', () => ({
  PreviewOperacao: (p: { aberto: boolean; promocaoId: string; tipo: string; acao: string; itens: { ml_item_id: string }[] }) => {
    if (p.aberto) preview(p);
    return null;
  },
}));

const fim = new Date(Date.now() + 5 * 86_400_000).toISOString();
const promo = (o: Partial<Promocao>): Promocao => ({
  promocao_id: 'P', tipo: 'DEAL', nome: 'Campanha', status: 'started', inicio: null, fim, prazo_adesao: null,
  beneficios: null, contagem: null, erro: null, itens_sincronizados_em: null, rodada_em_curso: null, ...o,
});
const part = (o: Partial<Participacao>): Participacao => ({
  promocao_id: 'P', ml_item_id: 'MLB1', status: 'started', preco_original: 30, preco_promo: 27, preco_min: null,
  preco_max: null, preco_sugerido: null, preco_avaliado: 27, ml_pct: null, estoque_min: null, titulo: 'Máscara',
  thumbnail: null, permalink: null, projecao: [], pior_semaforo: 'verde', anuncio_normal_id: null, ...o,
});

function renderLista() {
  render(<MemoryRouter><ListaParticipando /></MemoryRouter>);
}

describe('ListaParticipando', () => {
  beforeEach(() => {
    preview.mockClear();
    vi.mocked(usePromocoes).mockReturnValue({ data: [
      promo({ promocao_id: 'D', nome: '10.10' }),
      promo({ promocao_id: 'M', tipo: 'MARKETPLACE_CAMPAIGN', nome: 'Campanha do ML' }),
    ], isLoading: false } as never);
    vi.mocked(useParticipacoes).mockReturnValue({ data: [
      part({ promocao_id: 'D', ml_item_id: 'MLB7', anuncio_normal_id: 'MLB5', titulo: 'Máscara Tanox' }),
      part({ promocao_id: 'D', ml_item_id: 'MLB8', titulo: 'Shampoo' }),
      part({ promocao_id: 'M', ml_item_id: 'MLB9', titulo: 'Condicionador' }),
    ], isLoading: false } as never);
  });

  it('um bloco por campanha; par de catálogo aparece com o MLB do normal', () => {
    renderLista();
    expect(screen.getByRole('heading', { name: '10.10' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Campanha do ML' })).toBeTruthy();
    expect(screen.getByText('MLB5 · promoção via catálogo MLB7')).toBeTruthy();
  });

  it('Sair abre o preview da campanha certa só com os selecionados (id do catálogo)', async () => {
    renderLista();
    const bloco = screen.getByRole('region', { name: '10.10' });
    await userEvent.click(within(bloco).getByRole('checkbox', { name: 'Selecionar MLB5' }));
    await userEvent.click(within(bloco).getByRole('button', { name: 'Sair 1' }));
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'sair', promocaoId: 'D', tipo: 'DEAL', itens: [expect.objectContaining({ ml_item_id: 'MLB7' })],
    }));
  });

  it('tipo que o app não opera: sem seleção, com link para o Seller Center', () => {
    renderLista();
    const bloco = screen.getByRole('region', { name: 'Campanha do ML' });
    expect(within(bloco).queryByRole('checkbox')).toBeNull();
    expect(within(bloco).getByRole('link', { name: /Gerenciar no Mercado Livre/ })).toBeTruthy();
  });

  it('falha na carga não vira lista vazia', () => {
    vi.mocked(useParticipacoes).mockReturnValue({ data: undefined, isLoading: false, isError: true } as never);
    renderLista();
    expect(screen.getByText('Não foi possível carregar os anúncios em promoção.')).toBeTruthy();
    expect(screen.queryByText('Nenhum anúncio em promoção.')).toBeNull();
  });

  it('sem participações: estado vazio', () => {
    vi.mocked(useParticipacoes).mockReturnValue({ data: [], isLoading: false } as never);
    renderLista();
    expect(screen.getByText('Nenhum anúncio em promoção.')).toBeTruthy();
  });
});
