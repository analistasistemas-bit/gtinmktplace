import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { calcularVereditoAnuncios } from '@/lib/veredito-sonar';
import type { ItemVendasSonar, PainelVendasSonar } from '@/lib/sonar';
import { VereditoSonar } from '../veredito-sonar';

// Fixture mínima igual ao padrão de src/lib/__tests__/veredito-sonar.test.ts.
const itemV2 = (over: Partial<ItemVendasSonar> = {}): ItemVendasSonar => ({
  titulo: 'X', preco: 100, vendidos: 100, link: null, imagem: null, vendedor: 'LOJA-A',
  frete_gratis: false, loja_oficial: false, internacional: false, full: null, item_id: 'MLB1',
  catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: 1,
  patrocinado: false, selo: null, preco_anterior: null, desconto_pct: null, flex: null, ...over,
});

const painelSintetico = (itens: ItemVendasSonar[]): PainelVendasSonar => {
  const comVendas = itens.filter((i) => i.vendidos != null);
  return {
    configurado: true, termo: 'sintético', gerado_em: 'g', itens,
    itens_analisados: itens.length, itens_com_vendas: comVendas.length,
    vendas_totais: comVendas.reduce((a, i) => a + (i.vendidos ?? 0), 0),
    valor_mercado: comVendas.reduce((a, i) => a + (i.vendidos ?? 0) * (i.preco ?? 0), 0),
    produto_destaque: null, palavras_chave_titulos: [],
    por_anuncio: Object.fromEntries(itens.filter((i) => i.item_id).map((i) => [i.item_id!, i])),
    raio_x: {
      total_anuncios: null, ticket_medio: null,
      lojas_oficiais: itens.filter((i) => i.loja_oficial === true).length,
      full: itens.filter((i) => i.full === true).length,
      frete_gratis: itens.filter((i) => i.frete_gratis === true).length,
      internacionais: itens.filter((i) => i.internacional === true).length,
    },
  };
};

describe('VereditoSonar — Pódio de rivais', () => {
  const painel = painelSintetico([
    itemV2({
      item_id: 'MLB123', titulo: 'Anúncio Líder', vendedor: 'LOJA-A', vendidos: 50_000, preco: 22.23,
    }),
    itemV2({
      item_id: null, titulo: 'Anúncio Fantasma', vendedor: null, vendidos: 200, preco: 10, link: null,
    }),
  ]);
  const veredito = calcularVereditoAnuncios(painel, null);

  const montar = () => render(
    <VereditoSonar veredito={veredito} contexto={[]} vendas={painel} visitasPorItem={new Map()} />,
  );

  it('título do anúncio com href vira link para o Mercado Livre em nova aba', () => {
    montar();
    const link = screen.getByRole('link', { name: /Anúncio Líder/ });
    expect(link).toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('item sem href renderiza texto sem âncora', () => {
    montar();
    expect(screen.getByText('Anúncio Fantasma')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Anúncio Fantasma/ })).not.toBeInTheDocument();
  });

  it('quantidade vendida aparece com o prefixo "+" (faixa piso do ML, não número exato)', () => {
    montar();
    expect(screen.getByText(/\+50\.000 vendidos/)).toBeInTheDocument();
  });
});

describe('VereditoSonar — aviso de ficha de catálogo (bug real 02/09: link abriu preço diferente)', () => {
  it('rival com catalog_product_id ganha ícone de aviso ao lado do faturamento', () => {
    const painel = painelSintetico([
      itemV2({
        item_id: 'MLB3923932275', titulo: 'Nestlé Ninho Zero Lactose em pó 700g', vendedor: null,
        vendidos: 10_000, preco: 51.9, catalog_product_id: 'MLB14489497',
      }),
    ]);
    const veredito = calcularVereditoAnuncios(painel, null);
    render(<VereditoSonar veredito={veredito} contexto={[]} vendas={painel} visitasPorItem={new Map()} />);
    expect(screen.getByTitle(/pode ser outro vendedor\/preço/)).toBeInTheDocument();
  });

  it('rival sem catalog_product_id não ganha o aviso', () => {
    const painel = painelSintetico([
      itemV2({ item_id: 'MLB1', titulo: 'Anúncio Avulso', vendedor: 'LOJA-A', vendidos: 100, preco: 50, catalog_product_id: null }),
    ]);
    const veredito = calcularVereditoAnuncios(painel, null);
    render(<VereditoSonar veredito={veredito} contexto={[]} vendas={painel} visitasPorItem={new Map()} />);
    expect(screen.queryByTitle(/pode ser outro vendedor\/preço/)).not.toBeInTheDocument();
  });
});
