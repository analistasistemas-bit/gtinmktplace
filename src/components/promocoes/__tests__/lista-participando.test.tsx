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

  it('carregando mostra a logo PubliAI pulsando, não blocos cinza', async () => {
    vi.mocked(useParticipacoes).mockReturnValue({ data: undefined, isLoading: true } as never);
    renderLista();
    expect(await screen.findByRole('status', { name: 'Carregando' })).toHaveTextContent('Lendo os anúncios em promoção…');
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

  it('Sair de Relâmpago abre preview com tipo LIGHTNING', async () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo({ promocao_id: 'L', tipo: 'LIGHTNING', nome: 'Relâmpago X' })], isLoading: false } as never);
    vi.mocked(useParticipacoes).mockReturnValue({ data: [part({ promocao_id: 'L', ml_item_id: 'MLB3' })], isLoading: false } as never);
    renderLista();
    const bloco = screen.getByRole('region', { name: 'Relâmpago X' });
    await userEvent.click(within(bloco).getByRole('checkbox', { name: 'Selecionar MLB3' }));
    await userEvent.click(within(bloco).getByRole('button', { name: 'Sair 1' }));
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ acao: 'sair', tipo: 'LIGHTNING', promocaoId: 'L' }));
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

  // Emenda 2026-11-03: busca + "Alterar preço" em massa (só DEAL).
  it('busca filtra os blocos; "Selecionar todos" marca só o resultado; Alterar preço abre o preview certo', async () => {
    renderLista();
    await userEvent.type(screen.getByLabelText('Buscar anúncios em promoção'), 'mascara');
    expect(screen.queryByRole('heading', { name: 'Campanha do ML' })).toBeNull();
    const bloco = screen.getByRole('region', { name: '10.10' });
    expect(within(bloco).queryByText('Shampoo')).toBeNull();
    await userEvent.click(within(bloco).getByRole('checkbox', { name: 'Selecionar todos de 10.10' }));
    await userEvent.click(within(bloco).getByRole('button', { name: 'Alterar preço 1' }));
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'alterar_preco', promocaoId: 'D', tipo: 'DEAL', itens: [expect.objectContaining({ ml_item_id: 'MLB7' })],
    }));
  });

  it('busca sem resultado avisa; Relâmpago não oferece Alterar preço (o ML exige sair e entrar de novo)', async () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo({ promocao_id: 'L', tipo: 'LIGHTNING', nome: 'Relâmpago X' })], isLoading: false } as never);
    vi.mocked(useParticipacoes).mockReturnValue({ data: [part({ promocao_id: 'L', ml_item_id: 'MLB3' })], isLoading: false } as never);
    renderLista();
    const bloco = screen.getByRole('region', { name: 'Relâmpago X' });
    await userEvent.click(within(bloco).getByRole('checkbox', { name: 'Selecionar MLB3' }));
    expect(within(bloco).queryByRole('button', { name: /Alterar preço/ })).toBeNull();
    await userEvent.type(screen.getByLabelText('Buscar anúncios em promoção'), 'zzz');
    expect(screen.getByText('Nenhum anúncio em promoção com essa busca.')).toBeTruthy();
  });

  // Paginação por campanha (03/11): 20 por página, ordem de descrição, seleção vale para todas as páginas.
  describe('paginação', () => {
    const muitos = (promocao_id: string, n: number, prefixo = 'Item') =>
      Array.from({ length: n }, (_, k) => part({ promocao_id, ml_item_id: `MLB${promocao_id}${k}`, titulo: `${prefixo} ${String(k).padStart(2, '0')}` }));
    const linhas = (bloco: HTMLElement) => within(bloco).getAllByRole('checkbox', { name: /^Selecionar MLB/ });
    beforeEach(() => {
      vi.mocked(usePromocoes).mockReturnValue({ data: [promo({ promocao_id: 'D', nome: '10.10' }), promo({ promocao_id: 'E', nome: '11.11' })], isLoading: false } as never);
      vi.mocked(useParticipacoes).mockReturnValue({ data: [...muitos('D', 25).reverse(), ...muitos('E', 3)], isLoading: false } as never);
    });

    it('20 na 1ª página em ordem de descrição, 5 na 2ª; outra campanha não pagina', async () => {
      renderLista();
      const bloco = screen.getByRole('region', { name: '10.10' });
      expect(linhas(bloco)).toHaveLength(20);
      expect(within(bloco).getAllByText(/^Item \d+$/).map((e) => e.textContent).slice(0, 2)).toEqual(['Item 00', 'Item 01']);
      expect(linhas(screen.getByRole('region', { name: '11.11' }))).toHaveLength(3);
      await userEvent.click(within(bloco).getByRole('button', { name: 'Página 2' }));
      expect(linhas(bloco)).toHaveLength(5);
      expect(within(bloco).getByText('Item 24')).toBeTruthy();
      expect(linhas(screen.getByRole('region', { name: '11.11' }))).toHaveLength(3);
    });

    it('"Selecionar todos" marca as 25 (todas as páginas) e o preview recebe os 25 ids', async () => {
      renderLista();
      const bloco = screen.getByRole('region', { name: '10.10' });
      await userEvent.click(within(bloco).getByRole('checkbox', { name: 'Selecionar todos de 10.10' }));
      await userEvent.click(within(bloco).getByRole('button', { name: 'Alterar preço 25' }));
      const ids = (preview.mock.calls.at(-1)![0].itens as { ml_item_id: string }[]).map((i) => i.ml_item_id).sort();
      expect(ids).toEqual(muitos('D', 25).map((i) => i.ml_item_id).sort());
    });

    it('marcação sobrevive à troca de página; busca volta para a 1ª página', async () => {
      renderLista();
      const bloco = screen.getByRole('region', { name: '10.10' });
      await userEvent.click(within(bloco).getByRole('checkbox', { name: 'Selecionar MLBD0' }));
      await userEvent.click(within(bloco).getByRole('button', { name: 'Página 2' }));
      await userEvent.click(within(bloco).getByRole('checkbox', { name: 'Selecionar MLBD24' }));
      await userEvent.click(within(bloco).getByRole('button', { name: 'Página 1' }));
      expect(within(bloco).getByRole('checkbox', { name: 'Selecionar MLBD0' })).toBeChecked();
      expect(within(bloco).getByRole('button', { name: 'Alterar preço 2' })).toBeTruthy();
      await userEvent.click(within(bloco).getByRole('button', { name: 'Página 2' }));
      await userEvent.type(screen.getByLabelText('Buscar anúncios em promoção'), 'item');
      expect(linhas(screen.getByRole('region', { name: '10.10' }))).toHaveLength(20);
    });
  });
});
