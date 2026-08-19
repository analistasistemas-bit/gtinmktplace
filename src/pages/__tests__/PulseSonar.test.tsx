import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SonarVendas } from '../PulseSonar';
import type { ItemVendasSonar, PainelVendasSonar } from '@/lib/sonar';

// Card "Produto destaque" (SonarVendas): mesma regra de href do item_id da coluna de ações
// (D15/ADR-0127), aplicada ao `produto_destaque` do payload — ver task 15/16 (coordenador pediu
// paridade depois de o achado ficar restrito à coluna de ações).
function itemBase(overrides: Partial<ItemVendasSonar>): ItemVendasSonar {
  return {
    titulo: 'Produto destaque', preco: 100, vendidos: 10, link: null, imagem: null, vendedor: null,
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, item_id: null,
    catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: null,
    patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null, flex: null,
    ...overrides,
  };
}

function respBase(destaque: ItemVendasSonar | null): PainelVendasSonar {
  return {
    configurado: true, termo: 'tecido oxford', gerado_em: '2026-08-19T00:00:00Z',
    itens_analisados: 1, itens_com_vendas: 1, vendas_totais: 10, valor_mercado: 1000,
    produto_destaque: destaque, palavras_chave_titulos: [],
    raio_x: { total_anuncios: null, ticket_medio: null, lojas_oficiais: 0, full: 0, frete_gratis: 0, internacionais: 0 },
  };
}

describe('SonarVendas — card "Produto destaque" usa a mesma regra de link da coluna de ações', () => {
  it('link com domínio duplicado (caso real) cai para a URL canônica via item_id', () => {
    const destaque = itemBase({
      titulo: 'Tecido Oxford',
      link: 'https://www.mercadolivre.com.br/produto.mercadolivre.com.br/MLB-4278232959-tecido',
      item_id: 'MLB4278232959',
    });
    render(<SonarVendas resp={respBase(destaque)} />);
    expect(screen.getByRole('link', { name: 'Tecido Oxford' }))
      .toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-4278232959');
  });

  it('sem item_id disponível e sem link utilizável: sem link, mas o título continua visível', () => {
    const destaque = itemBase({ titulo: 'Sem item_id', link: null, item_id: null });
    render(<SonarVendas resp={respBase(destaque)} />);
    expect(screen.queryByRole('link', { name: 'Sem item_id' })).not.toBeInTheDocument();
    expect(screen.getByText('Sem item_id')).toBeInTheDocument();
  });
});
