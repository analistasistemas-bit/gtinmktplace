import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DialogDetalhe } from '../dialog-detalhe';
import type { PulseOferta, PulseProduto, PulseVendedor } from '@/lib/pulse';

const detalhe = vi.hoisted(() => ({
  ofertas: [] as PulseOferta[],
  ofertasAtuais: [] as PulseOferta[],
  vendedores: [] as PulseVendedor[],
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => (
      queryKey[1] === 'contexto-margem'
        ? { data: { custo: null, aliquotaPct: null }, isLoading: false }
        : { data: detalhe, isLoading: false }
    ),
  };
});

vi.mock('@/lib/pulse', () => ({
  fetchContextoMargem: vi.fn(),
  fetchPulseDetalhe: vi.fn(),
}));

vi.mock('@/components/pulse/dialog-reprecificar', () => ({
  DialogReprecificar: () => null,
}));

const produtoBase: PulseProduto = {
  id: 'produto-1',
  catalog_product_id: 'MLB123456',
  codigo_pai: null,
  titulo: 'Fórmula Infantil Aptamil Premium 1800g Danone',
  gtin: '0007891234567',
  origem: 'auto',
  status: 'ativo',
  catalogo_status: 'vinculado',
  ptw_status: null,
  ptw_preco_sugerido: null,
  ptw_aplicavel: null,
  ptw_custos: null,
  ultimo_snapshot_em: null,
  meu_preco: 81.99,
  meu_preco_em: null,
  anuncio_status: 'active',
  anuncio_sub_status: [],
  anuncio_status_em: null,
  comissao_pct: null,
  comissao_fixa: null,
  comissao_preco: null,
  comissao_em: null,
};

const oferta = (overrides: Partial<PulseOferta>): PulseOferta => ({
  item_id: 'MLB-OFFER',
  seller_id: 1,
  preco: 36,
  tier: 'gold_special',
  frete_gratis: false,
  loja_oficial: false,
  ativo: true,
  dia: '2026-08-20',
  permalink: null,
  visitas_30d: null,
  visitas_30d_em: null,
  ...overrides,
});

const vendedor = (seller_id: number, nickname: string): PulseVendedor => ({
  seller_id,
  nickname,
  power_seller: null,
  nivel: null,
  transactions_total: 0,
  dia: '2026-08-20',
  uf: 'RJ',
  reputacao_detalhe: null,
  perfil_coletado_em: null,
});

function renderDetalhe(produto: PulseProduto = produtoBase) {
  return render(<DialogDetalhe produto={produto} onFechar={vi.fn()} />);
}

beforeEach(() => {
  detalhe.ofertas = [];
  detalhe.ofertasAtuais = [
    oferta({
      item_id: 'MLB-OFFER-36',
      seller_id: 1,
      permalink: 'https://produto.mercadolivre.com.br/MLB-OFFER-36',
    }),
    oferta({ item_id: 'MLB-OFFER-49', seller_id: 2, preco: 49.9 }),
  ];
  detalhe.vendedores = [vendedor(1, 'SOUZABRUNA20230210001211'), vendedor(2, 'OUTRO-VENDEDOR')];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DialogDetalhe — links de ofertas do Mercado Livre', () => {
  it('mostra busca ampla por GTIN, com segurança e sem rota /p/', () => {
    renderDetalhe();

    const link = screen.getByRole('link', { name: /Buscar anúncios no Mercado Livre/i });
    expect(link).toHaveAttribute('href', 'https://lista.mercadolivre.com.br/0007891234567');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.getAttribute('href')).not.toContain('/p/');
  });

  it('não mostra link de busca quando faltam GTIN e título', () => {
    renderDetalhe({ ...produtoBase, gtin: null, titulo: null });

    const linksDeBusca = screen.queryAllByRole('link').filter((link) => (
      link.getAttribute('href')?.startsWith('https://lista.mercadolivre.com.br/')
    ));
    expect(linksDeBusca).toHaveLength(0);
  });

  it('abre o permalink individual e identifica oferta sem permalink', () => {
    renderDetalhe();

    expect(screen.getByText('Oferta')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Abrir oferta/i });
    expect(link).toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-OFFER-36');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Indisponível')).toBeInTheDocument();
  });

  it('usa largura desktop ampliada para manter a coluna Oferta visível', () => {
    renderDetalhe();

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-7xl');
  });
});
