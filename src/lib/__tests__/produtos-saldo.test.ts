import { describe, it, expect } from 'vitest';
import { agruparProdutosComSaldo, urlFotoMl } from '../produtos-saldo';

const linhas = [
  { codigo: 'A1', nome: 'Azul', cor: 'Azul', gtin: '789', estoque: 5, custo: 10, preco: 30,
    peso_gramas: 200, altura_cm: 10, largura_cm: 20, comprimento_cm: 30,
    familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', descricao_pai: 'Camiseta de algodão', criado_em: '2026-07-02' } },
  { codigo: 'A2', nome: 'Rosa', cor: 'Rosa', gtin: '790', estoque: 3, custo: 10, preco: 30,
    peso_gramas: 200, altura_cm: 10, largura_cm: 20, comprimento_cm: 30,
    familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', descricao_pai: 'Camiseta de algodão', criado_em: '2026-07-02' } },
  { codigo: 'B1', nome: null, cor: null, gtin: null, estoque: 0, custo: null, preco: 15,
    peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null,
    familias: { codigo_pai: 'P2', nome_pai: 'Meia', descricao_pai: null, criado_em: '2026-07-01' } },
];

describe('agruparProdutosComSaldo', () => {
  it('agrupa variações pelo produto pai', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r).toHaveLength(2);
    expect(r.find((p) => p.codigoPai === 'P1')!.variacoes).toHaveLength(2);
  });

  it('soma o saldo total do produto', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r.find((p) => p.codigoPai === 'P1')!.saldoTotal).toBe(8);
    expect(r.find((p) => p.codigoPai === 'P2')!.saldoTotal).toBe(0);
  });

  it('ordena por nome do produto', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r.map((p) => p.nomePai)).toEqual(['Camiseta', 'Meia']);
  });

  it('lista vazia devolve vazio', () => {
    expect(agruparProdutosComSaldo([])).toEqual([]);
  });

  // Achado do Diego (2026-07-29): estes campos existiam no cadastro mas não apareciam
  // depois na tela de Estoque — dado gravado, mas invisível para conferência.
  it('propaga gtin, dimensões e descrição do produto para a tela', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    const p1 = r.find((p) => p.codigoPai === 'P1')!;
    expect(p1.descricaoPai).toBe('Camiseta de algodão');
    const a1 = p1.variacoes.find((v) => v.codigo === 'A1')!;
    expect(a1.gtin).toBe('789');
    expect(a1.pesoGramas).toBe(200);
    expect(a1.alturaCm).toBe(10);
    expect(a1.larguraCm).toBe(20);
    expect(a1.comprimentoCm).toBe(30);
  });

  // Âncora do ADR-0025: a família mais recente de cada codigo_pai é a canônica — a mesma
  // que baixar_estoque e o worker de push usam. Org de planilha tem N lotes do mesmo
  // produto; sem o corte a tela duplicaria a variação e somaria saldo histórico.
  it('mantém só a família mais recente de cada codigo_pai', () => {
    const r = agruparProdutosComSaldo([
      { codigo: 'A1', nome: null, cor: null, gtin: null, estoque: 2, custo: null, preco: 10,
        peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null,
        familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', descricao_pai: null, criado_em: '2026-06-01' } },
      { codigo: 'A1', nome: null, cor: null, gtin: null, estoque: 9, custo: null, preco: 10,
        peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null,
        familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', descricao_pai: null, criado_em: '2026-07-02' } },
    ] as never);
    expect(r).toHaveLength(1);
    expect(r[0].variacoes).toHaveLength(1);
    expect(r[0].saldoTotal).toBe(9);
  });

  it('linha sem família é ignorada', () => {
    expect(agruparProdutosComSaldo([
      { codigo: 'X', nome: null, cor: null, gtin: null, estoque: 5, custo: null, preco: 1,
        peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null, familias: null },
    ] as never)).toEqual([]);
  });

  it('copia os campos novos da família e da variação para o produto agrupado', () => {
    const linhas = [{
      codigo: '00000002', nome: null, cor: 'azul', gtin: '789', estoque: 5,
      custo: 10, preco: 20, peso_gramas: null, altura_cm: null, largura_cm: null,
      comprimento_cm: null, imagem_path: 'org/lote/00000002.jpg',
      familias: {
        codigo_pai: '00000001', nome_pai: 'Camiseta', descricao_pai: null,
        criado_em: '2026-08-01T10:00:00Z', capa_storage_path: 'org/lote/capa.jpg',
        fornecedor: 'Fornecedor X', unidade: 'UN', origem: 'nacional',
        ml_item_id: 'MLB123',
      },
    }];
    const [p] = agruparProdutosComSaldo(linhas as never);
    expect(p.capaStoragePath).toBe('org/lote/capa.jpg');
    expect(p.fornecedor).toBe('Fornecedor X');
    expect(p.unidade).toBe('UN');
    expect(p.origem).toBe('nacional');
    expect(p.mlItemId).toBe('MLB123');
    expect(p.criadoEm).toBe('2026-08-01T10:00:00Z');
    expect(p.variacoes[0].imagemPath).toBe('org/lote/00000002.jpg');
  });
});

// Produto de planilha quase nunca tem capa própria: na org da AVIL, 1 de 147 famílias tinha.
// A foto que existe é a do anúncio no ML, guardada em `variacoes.ml_picture_id`.
describe('agruparProdutosComSaldo — foto do produto pai', () => {
  function linha(codigo: string, over: Record<string, unknown> = {}, fam: Record<string, unknown> = {}) {
    return {
      codigo, nome: null, cor: null, gtin: null, estoque: 1, custo: null, preco: 10,
      peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null,
      imagem_path: null, ml_picture_id: null, ...over,
      familias: {
        codigo_pai: 'P1', nome_pai: 'Produto', descricao_pai: null,
        criado_em: '2026-08-01T10:00:00Z', capa_storage_path: null, capa_ml_picture_id: null,
        variacao_principal_codigo: null, fornecedor: null, unidade: 'UN', origem: 'nacional',
        ml_item_id: null, ...fam,
      },
    };
  }

  it('herda o ml_picture_id da primeira variação que tiver foto', () => {
    const [p] = agruparProdutosComSaldo([
      linha('A'),
      linha('B', { ml_picture_id: 'PIC-B' }),
    ] as never);
    expect(p.capaMlPictureId).toBe('PIC-B');
  });

  it('prefere a variação principal, mesmo quando ela vem depois', () => {
    const [p] = agruparProdutosComSaldo([
      linha('A', { ml_picture_id: 'PIC-A' }, { variacao_principal_codigo: 'B' }),
      linha('B', { ml_picture_id: 'PIC-B' }, { variacao_principal_codigo: 'B' }),
    ] as never);
    expect(p.capaMlPictureId).toBe('PIC-B');
  });

  it('capa própria da família vence a foto da variação', () => {
    const [p] = agruparProdutosComSaldo([
      linha('A', { ml_picture_id: 'PIC-A' }, { capa_ml_picture_id: 'PIC-CAPA' }),
    ] as never);
    expect(p.capaMlPictureId).toBe('PIC-CAPA');
  });

  it('sem foto em lugar nenhum devolve null, não undefined', () => {
    const [p] = agruparProdutosComSaldo([linha('A')] as never);
    expect(p.capaMlPictureId).toBeNull();
    expect(p.capaStoragePath).toBeNull();
  });

  it('herda também o imagem_path do Storage quando a família não tem capa', () => {
    const [p] = agruparProdutosComSaldo([
      linha('A', { imagem_path: 'org/lote/A.jpg' }),
    ] as never);
    expect(p.capaStoragePath).toBe('org/lote/A.jpg');
  });
});

describe('urlFotoMl', () => {
  it('monta a miniatura pública do ML', () => {
    expect(urlFotoMl('867646-MLB112367549742_062026'))
      .toBe('https://http2.mlstatic.com/D_867646-MLB112367549742_062026-V.jpg');
  });

  it('sem picture id devolve null — o componente cai no placeholder', () => {
    expect(urlFotoMl(null)).toBeNull();
    expect(urlFotoMl(undefined)).toBeNull();
    expect(urlFotoMl('')).toBeNull();
  });
});

describe('mapResumoEstoqueRpc', () => {
  it('mapeia KPIs e produtos slim da resposta do RPC', async () => {
    const { mapResumoEstoqueRpc } = await import('../produtos-saldo');
    const r = mapResumoEstoqueRpc({
      kpis: {
        produtos: 2, skus: 5, unidades: 100, skus_sem_estoque: 1,
        valor_em_estoque: 500.5, skus_sem_custo: 2,
      },
      produtos: [{
        codigo_pai: 'P1', nome_pai: 'Camiseta', descricao_pai: null,
        saldo_total: 8, qtd_skus: 2,
        capa_storage_path: null, capa_ml_picture_id: 'PIC1',
        fornecedor: 'X', unidade: 'UN', origem: 'nacional',
        ml_item_id: null, criado_em: '2026-08-01T10:00:00Z',
        gtins: ['789'], codigos: ['A1', 'A2'], cores: ['Azul'], sku_unico: null,
      }],
    });
    expect(r.kpis.skusSemEstoque).toBe(1);
    expect(r.kpis.valorEmEstoque).toBe(500.5);
    expect(r.produtos[0].codigoPai).toBe('P1');
    expect(r.produtos[0].gtins).toEqual(['789']);
    expect(r.produtos[0].cores).toEqual(['Azul']);
  });
});
