import { describe, expect, it } from 'vitest';
import {
  montarPainelVendas, parseItensApify, parsePrecoApify, parseTotalAnuncios, parseVendidos,
  type ItemVendas,
} from '../sonar-vendas.ts';

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
    }]);
  });

  it('campos do raio-X ausentes viram null, nunca false inventado', () => {
    const [item] = parseItensApify([{ eTituloProduto: 'X', novoPreco: '10' }]);
    expect(item.frete_gratis).toBeNull();
    expect(item.loja_oficial).toBeNull();
    expect(item.internacional).toBeNull();
    expect(item.full).toBeNull(); // envio vazio → não dá pra afirmar que não é Full
  });
  it('corpo inválido → []', () => {
    expect(parseItensApify(null)).toEqual([]);
    expect(parseItensApify({ error: 'x' })).toEqual([]);
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
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, ...over,
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
});
