import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SonarVendas, SonarEanResultado } from '../PulseSonar';
import type {
  CruzamentoEan, ItemVendasSonar, PainelVendasSonar, ResultadoEanCatalogado,
} from '@/lib/sonar';

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

// ADR-0127 Errata 2: a consulta por EAN precisa responder "devo vender isto?". O caso que originou
// a errata (EAN 7891000444764, 1 oferta, tudo "—") não dizia nada ao analista comercial.
function respEan(overrides: Partial<ResultadoEanCatalogado> = {}): ResultadoEanCatalogado {
  return {
    conectado: true, catalogado: true, ean: '7891000444764', product_id: 'MLB123',
    nome_produto: 'Leite Em Pó Ninho Zero Lactose Sachê 700g', descricao_catalogo: null,
    com_vendas: false, gerado_em: '2026-08-27T00:00:00Z',
    ofertas: [{ item_id: 'MLB1', seller_id: 780167992, preco: 80, frete_gratis: true, full: false, vendidos: null }],
    ...overrides,
  };
}

describe('SonarEanResultado — cruzamento com o catálogo da org (Errata 2)', () => {
  it('já vendo o produto: mostra código e preço da variação', () => {
    const cruzamento: CruzamentoEan = {
      minhas: [{ codigo: '1042', nome: 'Ninho Zero Lactose', preco: 74.9 }],
      no_radar: null,
    };
    render(<SonarEanResultado resp={respEan()} cruzamento={cruzamento} onNovaConsulta={() => {}} />);
    expect(screen.getByText(/Você já vende: 1042/)).toBeInTheDocument();
    expect(screen.getByText(/74,90/)).toBeInTheDocument();
  });

  it('produto já monitorado: informa o Radar, com o status quando não está ativo', () => {
    const cruzamento: CruzamentoEan = {
      minhas: [],
      no_radar: { id: 'p1', titulo: 'Ninho', status: 'pausado' },
    };
    render(<SonarEanResultado resp={respEan()} cruzamento={cruzamento} onNovaConsulta={() => {}} />);
    expect(screen.getByText(/Já está no seu Radar \(pausado\)/)).toBeInTheDocument();
  });

  it('sem nada: diz que é produto novo — ausência informa, não é espaço em branco', () => {
    render(
      <SonarEanResultado
        resp={respEan()}
        cruzamento={{ minhas: [], no_radar: null }}
        onNovaConsulta={() => {}}
      />
    );
    expect(screen.getByText(/Produto novo para a operação/)).toBeInTheDocument();
  });

  it('cruzamento ainda carregando: não afirma nem que vende nem que é novo', () => {
    render(<SonarEanResultado resp={respEan()} onNovaConsulta={() => {}} />);
    expect(screen.queryByText(/Produto novo para a operação/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Você já vende/)).not.toBeInTheDocument();
  });

  it('descrição do catálogo já vinha na resposta e agora é renderizada', () => {
    const resp = respEan({ descricao_catalogo: 'Leite em pó integral, zero lactose, sachê 700 g.' });
    render(<SonarEanResultado resp={resp} onNovaConsulta={() => {}} />);
    expect(screen.getByText(/zero lactose, sachê 700 g/)).toBeInTheDocument();
  });
});
