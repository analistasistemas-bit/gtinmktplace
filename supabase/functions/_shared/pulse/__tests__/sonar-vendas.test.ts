import { describe, expect, it } from 'vitest';
import {
  indexarPorAnuncio, linhasSnapshot, montarPainelVendas, parseItensApify, parsePrecoApify,
  parseSellerId, parseTotalAnuncios, parseVendidos, type ItemVendas,
} from '../sonar-vendas.ts';

// Campos "extra" default de um ItemVendas totalmente vazio (T1) — usado nos testes que já
// existiam antes desta entrega, para não afrouxar o toEqual quando a interface cresce.
const EXTRA_VAZIO = {
  item_id: null, catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null,
  posicao: null, patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null,
  flex: null, category_id: null, seller_id: null,
};

describe('parseVendidos', () => {
  it('número cru vira inteiro', () => {
    expect(parseVendidos(500)).toBe(500);
    expect(parseVendidos(0)).toBe(0);
  });
  it('strings da página: "+500 vendidos", "1.000", "5 mil", "5,5 mil"', () => {
    expect(parseVendidos('+500 vendidos')).toBe(500);
    expect(parseVendidos('1.000')).toBe(1000);
    expect(parseVendidos('5 mil')).toBe(5000);
    expect(parseVendidos('+5,5 mil vendidos')).toBe(5500);
  });
  it('sem dado/ilegível → null, nunca 0', () => {
    expect(parseVendidos(null)).toBeNull();
    expect(parseVendidos(undefined)).toBeNull();
    expect(parseVendidos('novo')).toBeNull();
    expect(parseVendidos(-3)).toBeNull();
  });
});

describe('parseSellerId', () => {
  it('número ou string numérica vira inteiro positivo', () => {
    expect(parseSellerId(123456)).toBe(123456);
    expect(parseSellerId('987654')).toBe(987654);
  });
  it('ausente, zero, negativo ou ilegível → null', () => {
    expect(parseSellerId(null)).toBeNull();
    expect(parseSellerId('')).toBeNull();
    expect(parseSellerId(0)).toBeNull();
    expect(parseSellerId(-1)).toBeNull();
    expect(parseSellerId('abc')).toBeNull();
  });
});

describe('parsePrecoApify', () => {
  it('número e string sem separador', () => {
    expect(parsePrecoApify(4299)).toBe(4299);
    expect(parsePrecoApify('4299')).toBe(4299);
  });
  it('formatos pt-BR: milhar com ponto, decimal com vírgula, prefixo R$', () => {
    expect(parsePrecoApify('4.299')).toBe(4299);
    expect(parsePrecoApify('4.299,90')).toBe(4299.9);
    expect(parsePrecoApify('R$ 129,90')).toBe(129.9);
  });
  it('decimal com ponto simples não é tratado como milhar', () => {
    expect(parsePrecoApify('4.5')).toBe(4.5);
  });
  it('ilegível ou não positivo → null', () => {
    expect(parsePrecoApify('')).toBeNull();
    expect(parsePrecoApify(null)).toBeNull();
    expect(parsePrecoApify(0)).toBeNull();
  });
});

describe('parseItensApify', () => {
  it('mapeia campos do actor (incl. os do raio-X) e descarta item sem título', () => {
    const json = [
      {
        eTituloProduto: 'Protetor Solar Facial FPS 60',
        novoPreco: '89,90',
        quantidadeVendida: 500,
        zProdutoLink: 'https://www.mercadolivre.com.br/p/MLB123',
        imagemLink: 'https://http2.mlstatic.com/x.webp',
        Vendedor: 'LOJA X',
        freteGratis: true,
        lojaOficial: false,
        eCompraInternacional: false,
        envio: 'Chegará grátis amanhã Enviado pelo FULL',
      },
      { novoPreco: '10' },
    ];
    expect(parseItensApify(json)).toEqual([{
      titulo: 'Protetor Solar Facial FPS 60',
      preco: 89.9,
      vendidos: 500,
      link: 'https://www.mercadolivre.com.br/p/MLB123',
      imagem: 'https://http2.mlstatic.com/x.webp',
      vendedor: 'LOJA X',
      frete_gratis: true,
      loja_oficial: false,
      internacional: false,
      full: true,
      ...EXTRA_VAZIO,
      flex: false, // envio presente ("...Enviado pelo FULL") sem "flex" no texto → false, não null
    }]);
  });

  it('campos do raio-X ausentes viram null, nunca false inventado', () => {
    const [item] = parseItensApify([{ eTituloProduto: 'X', novoPreco: '10' }]);
    expect(item.frete_gratis).toBeNull();
    expect(item.loja_oficial).toBeNull();
    expect(item.internacional).toBeNull();
    expect(item.full).toBeNull(); // envio vazio → não dá pra afirmar que não é Full
  });
  it('vendedorID: string numérica ou número mapeia seller_id; ausente → null', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', vendedorID: '12345' }])[0].seller_id).toBe(12345);
    expect(parseItensApify([{ eTituloProduto: 'X', vendedorID: 67890 }])[0].seller_id).toBe(67890);
    expect(parseItensApify([{ eTituloProduto: 'X' }])[0].seller_id).toBeNull();
  });

  it('corpo inválido → []', () => {
    expect(parseItensApify(null)).toEqual([]);
    expect(parseItensApify({ error: 'x' })).toEqual([]);
  });

  // Campos novos (T1, paridade Hunter) — valores REAIS medidos no dataset de produção em
  // 2026-08-18 (termo "abraçadeira nylon"), registrados no ADR-0125.
  it('idPublicacao/idProdutoCatalogo: string não-vazia mapeia, "" vira null', () => {
    const [comAmbos] = parseItensApify([{
      eTituloProduto: 'X', idPublicacao: 'MLB4445303151', idProdutoCatalogo: 'MLB73054518',
    }]);
    expect(comAmbos.item_id).toBe('MLB4445303151');
    expect(comAmbos.catalog_product_id).toBe('MLB73054518');

    const [semCatalogo] = parseItensApify([{ eTituloProduto: 'X', idPublicacao: 'MLB1', idProdutoCatalogo: '' }]);
    expect(semCatalogo.catalog_product_id).toBeNull();
  });

  it('produtoReviews: "4.9" e "4,9" viram 4.9; fora de 0–5 vira null', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', produtoReviews: '4.9' }])[0].avaliacao_nota).toBe(4.9);
    expect(parseItensApify([{ eTituloProduto: 'X', produtoReviews: '4,9' }])[0].avaliacao_nota).toBe(4.9);
    expect(parseItensApify([{ eTituloProduto: 'X', produtoReviews: '6' }])[0].avaliacao_nota).toBeNull();
    expect(parseItensApify([{ eTituloProduto: 'X' }])[0].avaliacao_nota).toBeNull();
  });

  it('numeroAvaliacoes: aceita "(84)" e "84"; vazio vira null', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', numeroAvaliacoes: '(84)' }])[0].avaliacao_qtd).toBe(84);
    expect(parseItensApify([{ eTituloProduto: 'X', numeroAvaliacoes: '84' }])[0].avaliacao_qtd).toBe(84);
    expect(parseItensApify([{ eTituloProduto: 'X', numeroAvaliacoes: '' }])[0].avaliacao_qtd).toBeNull();
  });

  it('posicaoItem: inteiro ≥1 mapeia; ausente/inválido vira null', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', posicaoItem: 1 }])[0].posicao).toBe(1);
    expect(parseItensApify([{ eTituloProduto: 'X', posicaoItem: 0 }])[0].posicao).toBeNull();
    expect(parseItensApify([{ eTituloProduto: 'X' }])[0].posicao).toBeNull();
  });

  it('tipoResultado (NUNCA o campo `patrocinado` do actor): ORGANIC→false, outro→true, ausente→null', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', tipoResultado: 'ORGANIC' }])[0].patrocinado).toBe(false);
    expect(parseItensApify([{ eTituloProduto: 'X', tipoResultado: 'ADVERTISING' }])[0].patrocinado).toBe(true);
    expect(parseItensApify([{ eTituloProduto: 'X' }])[0].patrocinado).toBeNull();
    expect(parseItensApify([{ eTituloProduto: 'X', tipoResultado: 'ORGANIC', patrocinado: true }])[0].patrocinado).toBe(false);
  });

  it('highlight: "" vira null, string real mapeia', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', highlight: 'MAIS VENDIDO' }])[0].selo).toBe('MAIS VENDIDO');
    expect(parseItensApify([{ eTituloProduto: 'X', highlight: '' }])[0].selo).toBeNull();
  });

  it('precoAnterior (pt-BR, reusa parsePrecoApify) e precoDiscount ("13% OFF" → 13)', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', precoAnterior: '45,9' }])[0].preco_anterior).toBe(45.9);
    expect(parseItensApify([{ eTituloProduto: 'X', precoDiscount: '13% OFF' }])[0].desconto_pct).toBe(13);
    expect(parseItensApify([{ eTituloProduto: 'X' }])[0].desconto_pct).toBeNull();
  });

  it('flex: mesmo padrão do full, a partir do texto de envio', () => {
    expect(parseItensApify([{ eTituloProduto: 'X', envio: 'Enviado pelo FLEX' }])[0].flex).toBe(true);
    expect(parseItensApify([{ eTituloProduto: 'X', envio: 'Frete grátis Enviado pelo FULL' }])[0].flex).toBe(false);
    expect(parseItensApify([{ eTituloProduto: 'X' }])[0].flex).toBeNull();
  });
});

describe('indexarPorAnuncio', () => {
  const item = (over: Partial<ItemVendas>): ItemVendas => ({
    titulo: 'Produto', preco: null, vendidos: null, link: null, imagem: null, vendedor: null,
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, ...EXTRA_VAZIO, ...over,
  });

  it('indexa por item_id (idPublicacao)', () => {
    const a = item({ item_id: 'MLB1' });
    const b = item({ item_id: 'MLB2' });
    expect(indexarPorAnuncio([a, b])).toEqual({ MLB1: a, MLB2: b });
  });

  it('item sem item_id fica fora do índice', () => {
    expect(indexarPorAnuncio([item({ item_id: null })])).toEqual({});
  });

  it('colisão de item_id: fica com o primeiro (ordem de relevância)', () => {
    const primeiro = item({ item_id: 'MLB1', titulo: 'Primeiro' });
    const segundo = item({ item_id: 'MLB1', titulo: 'Segundo' });
    expect(indexarPorAnuncio([primeiro, segundo])).toEqual({ MLB1: primeiro });
  });
});

describe('parseTotalAnuncios', () => {
  it('lê "8.973 resultados" do 1º item', () => {
    expect(parseTotalAnuncios([{ resultadosTotais: '8.973 resultados' }])).toBe(8973);
    expect(parseTotalAnuncios([{ resultadosTotais: 8973 }])).toBe(8973);
  });
  it('ausente/ilegível/vazio → null', () => {
    expect(parseTotalAnuncios([{ resultadosTotais: 'resultados' }])).toBeNull();
    expect(parseTotalAnuncios([{}])).toBeNull();
    expect(parseTotalAnuncios([])).toBeNull();
    expect(parseTotalAnuncios(null)).toBeNull();
  });
});

describe('montarPainelVendas', () => {
  const item = (over: Partial<ItemVendas>): ItemVendas => ({
    titulo: 'Produto', preco: null, vendidos: null, link: null, imagem: null, vendedor: null,
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, ...EXTRA_VAZIO, ...over,
  });

  it('raio_x conta só os true da amostra e tira o ticket médio dos preços presentes', () => {
    const p = montarPainelVendas('x', [
      item({ preco: 10, loja_oficial: true, full: true, frete_gratis: true, internacional: false }),
      item({ preco: 30, loja_oficial: true, full: null, frete_gratis: false, internacional: true }),
      item({ preco: null, loja_oficial: null, full: false, frete_gratis: true, internacional: null }),
    ], 8973);
    expect(p.raio_x).toEqual({
      total_anuncios: 8973,
      ticket_medio: 20,
      lojas_oficiais: 2,
      full: 1,
      frete_gratis: 2,
      internacionais: 1,
    });
  });

  it('sem preços e sem total → ticket_medio e total_anuncios null', () => {
    const p = montarPainelVendas('x', [item({})]);
    expect(p.raio_x.ticket_medio).toBeNull();
    expect(p.raio_x.total_anuncios).toBeNull();
  });

  it('soma vendas e valor só de quem tem o dado; null nunca vira zero no denominador', () => {
    const p = montarPainelVendas('solar', [
      item({ titulo: 'A solar', preco: 100, vendidos: 500 }),
      item({ titulo: 'B solar', preco: 50, vendidos: null }),
      item({ titulo: 'C solar', preco: null, vendidos: 100 }),
    ]);
    expect(p.itens_analisados).toBe(3);
    expect(p.itens_com_vendas).toBe(2);
    expect(p.vendas_totais).toBe(600);
    expect(p.valor_mercado).toBe(100 * 500); // C não entra: sem preço
  });

  it('produto_destaque é o mais vendido (> 0); tudo null → destaque null', () => {
    const a = item({ titulo: 'A', vendidos: 10 });
    const b = item({ titulo: 'B', vendidos: 900 });
    expect(montarPainelVendas('x', [a, b]).produto_destaque).toEqual(b);
    expect(montarPainelVendas('x', [item({}), item({})]).produto_destaque).toBeNull();
    expect(montarPainelVendas('x', [item({ vendidos: 0 })]).produto_destaque).toBeNull();
  });

  it('extrai palavras-chave dos títulos reais', () => {
    const p = montarPainelVendas('solar', [
      item({ titulo: 'Protetor Solar Facial' }),
      item({ titulo: 'Protetor Solar Corporal' }),
    ]);
    expect(p.palavras_chave_titulos[0]).toEqual({ termo: 'protetor', contagem: 2 });
  });

  it('expõe por_anuncio (T1/D4) — mesmo índice de indexarPorAnuncio', () => {
    const a = item({ item_id: 'MLB1' });
    const b = item({ item_id: null }); // sem item_id: fica fora do índice
    const p = montarPainelVendas('x', [a, b]);
    expect(p.por_anuncio).toEqual({ MLB1: a });
  });
});

const itemBase = (over: Partial<ItemVendas> = {}): ItemVendas => ({
  titulo: 'Abraçadeira nylon 200un', preco: 12.9, vendidos: 500, link: null, imagem: null,
  vendedor: 'FIXA-FORTE', seller_id: null, frete_gratis: true, loja_oficial: false, internacional: false,
  full: true, item_id: 'MLB111', catalog_product_id: null, category_id: 'MLB1499',
  avaliacao_nota: 4.8, avaliacao_qtd: 84, posicao: 1, patrocinado: false, selo: null,
  preco_anterior: null, desconto_pct: null, flex: false, ...over,
});

describe('category_id — produtoCategoryID (20/20 no dataset medido 18/08; destrava o simulador sem preditor)', () => {
  it('parseia produtoCategoryID e trata vazio como null', () => {
    const [comCat] = parseItensApify([{ eTituloProduto: 'X', produtoCategoryID: 'MLB1499' }]);
    const [semCat] = parseItensApify([{ eTituloProduto: 'Y', produtoCategoryID: '' }]);
    expect(comCat.category_id).toBe('MLB1499');
    expect(semCat.category_id).toBeNull();
  });
});

describe('painel expõe `itens` (amostra completa, ordem da busca — a tabela nasce daqui)', () => {
  it('itens preserva a lista e a ordem, inclusive item sem item_id (que fica fora de por_anuncio)', () => {
    const a = itemBase({ item_id: 'MLB1', posicao: 1 });
    const b = itemBase({ item_id: null, posicao: 2, titulo: 'Sem id' });
    const painel = montarPainelVendas('t', [a, b], null);
    expect(painel.itens).toEqual([a, b]);
    expect(Object.keys(painel.por_anuncio)).toEqual(['MLB1']);
  });
});

describe('linhasSnapshot — D7/D13: uma linha por anúncio, null nunca vira 0', () => {
  it('mapeia os 10 campos e preserva null (vendidos null NUNCA vira 0)', () => {
    const linhas = linhasSnapshot('abraçadeira nylon', '2026-08-19T12:00:00.000Z',
      [itemBase({ vendidos: null, preco: null })]);
    expect(linhas).toEqual([{
      termo: 'abraçadeira nylon', gerado_em: '2026-08-19T12:00:00.000Z', item_id: 'MLB111',
      titulo: 'Abraçadeira nylon 200un', preco: null, vendidos: null, posicao: 1,
      patrocinado: false, vendedor: 'FIXA-FORTE', catalog_product_id: null,
    }]);
  });
  it('descarta item sem item_id (sem chave não há série histórica)', () => {
    expect(linhasSnapshot('t', 'g', [itemBase({ item_id: null })])).toEqual([]);
  });
});
