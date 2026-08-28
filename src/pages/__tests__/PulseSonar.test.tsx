import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SonarVendas, SonarEanCruzamento } from '../PulseSonar';
import type { CruzamentoEan, ItemVendasSonar, PainelVendasSonar } from '@/lib/sonar';

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

// ADR-0140 D-3: a consulta por EAN deixou de ter view própria — percorre o mesmo pipeline da busca
// por termo. O cruzamento com o catálogo da org é a única peça que sobrou dela, e as suas duas
// metades passaram a ter confiabilidade diferente: `minhas` vem de `variacoes.gtin` (exato, local),
// `no_radar` vem de `catalog_product_id` colhido da amostra da busca — que na medição de 28/08
// trouxe o id em 7 dos 20 anúncios. Por isso o Radar só pode ser afirmado no positivo.
describe('SonarEanCruzamento — afirma o que mediu, cala sobre o que não mediu', () => {
  const vazio: CruzamentoEan = { minhas: [], no_radar: null };

  it('já vendo o produto: mostra código e preço da variação', () => {
    const cruzamento: CruzamentoEan = {
      minhas: [{ codigo: '00123', nome: 'Linha Encanto Slim', preco: 39.9 }],
      no_radar: null,
    };
    render(<SonarEanCruzamento cruzamento={cruzamento} />);
    expect(screen.getByText(/Você já vende: 00123 \(R\$ 39,90\)/)).toBeInTheDocument();
  });

  it('produto já monitorado: informa o Radar, com o status quando não está ativo', () => {
    const cruzamento: CruzamentoEan = {
      minhas: [],
      no_radar: { id: 'p1', titulo: 'Linha Encanto Slim', status: 'pausado' },
    };
    render(<SonarEanCruzamento cruzamento={cruzamento} />);
    expect(screen.getByText(/Já está no seu Radar \(pausado\)/)).toBeInTheDocument();
  });

  it('nada encontrado: afirma só o catálogo (GTIN exato) e NÃO nega o Radar', () => {
    render(<SonarEanCruzamento cruzamento={vazio} />);
    // A ausência em `variacoes.gtin` é medição exata — pode virar frase.
    expect(screen.getByText(/Produto novo para o seu catálogo/)).toBeInTheDocument();
    // A ausência no Radar NÃO é: os ids de catálogo vêm parciais da amostra. Dizer "não está no
    // Radar" a partir disso é a mentira que a regra LOUD proíbe.
    expect(screen.queryByText(/Radar/)).not.toBeInTheDocument();
  });
});
