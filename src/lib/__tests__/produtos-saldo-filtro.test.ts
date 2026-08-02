import { describe, expect, it } from 'vitest';
import { filtrarProdutos, canaisEfetivos, type FiltroEstoque } from '../produtos-saldo-filtro';
import type { ProdutoComSaldo } from '../produtos-saldo';

function produto(over: Partial<ProdutoComSaldo> = {}): ProdutoComSaldo {
  return {
    codigoPai: '00000001', nomePai: 'Protetor Solar', descricaoPai: null,
    capaStoragePath: null, fornecedor: 'Eucerin', unidade: 'UN',
    origem: 'nacional', mlItemId: null, criadoEm: '2026-08-01T10:00:00Z',
    saldoTotal: 20,
    variacoes: [{
      codigo: '00000002', nome: null, cor: 'incolor', gtin: '4005800241901',
      estoque: 20, custo: 10, preco: 20, pesoGramas: null, alturaCm: null,
      larguraCm: null, comprimentoCm: null, imagemPath: null,
    }],
    ...over,
  };
}

const base = { filtro: 'todos' as FiltroEstoque, ordem: 'nome' as const, canaisPorProduto: new Map() };

describe('filtrarProdutos — busca', () => {
  it('acha pelo GTIN da variação', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: '4005800241901' })).toHaveLength(1);
  });

  it('acha pelo fornecedor', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: 'eucerin' })).toHaveLength(1);
  });

  it('acha pela cor da variação', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: 'incolor' })).toHaveLength(1);
  });

  it('ignora acento e caixa', () => {
    const p = produto({ nomePai: 'Loção Hidratante' });
    expect(filtrarProdutos([p], { ...base, termo: 'LOCAO' })).toHaveLength(1);
  });

  it('não acha o que não existe', () => {
    expect(filtrarProdutos([produto()], { ...base, termo: 'inexistente' })).toHaveLength(0);
  });
});

describe('filtrarProdutos — sem-estoque', () => {
  it('inclui saldo zero E saldo negativo', () => {
    const lista = [produto({ saldoTotal: 0 }), produto({ codigoPai: 'X', saldoTotal: -3 }), produto({ codigoPai: 'Y', saldoTotal: 5 })];
    const r = filtrarProdutos(lista, { ...base, termo: '', filtro: 'sem-estoque' });
    expect(r.map((p) => p.saldoTotal).sort()).toEqual([-3, 0]);
  });
});

describe('filtrarProdutos — nao-publicado', () => {
  const semCanal = produto();

  it('exclui quem tem canal no espelho', () => {
    const canais = new Map([['00000001', ['mercado_livre']]]);
    const r = filtrarProdutos([semCanal], { ...base, termo: '', filtro: 'nao-publicado', canaisPorProduto: canais });
    expect(r).toHaveLength(0);
  });

  it('inclui quem não tem canal nem ml_item_id', () => {
    const r = filtrarProdutos([semCanal], { ...base, termo: '', filtro: 'nao-publicado' });
    expect(r).toHaveLength(1);
  });

  // A guarda do defeito mais grave da spec (§3.4): anuncios_externos é espelho best-effort.
  it('NÃO marca como não publicado quem tem ml_item_id mas não tem linha no espelho', () => {
    const p = produto({ mlItemId: 'MLB123' });
    const r = filtrarProdutos([p], { ...base, termo: '', filtro: 'nao-publicado' });
    expect(r).toHaveLength(0);
  });

  it('com canaisPorProduto undefined não devolve tudo como não publicado', () => {
    const r = filtrarProdutos([semCanal], { ...base, termo: '', filtro: 'nao-publicado', canaisPorProduto: undefined });
    expect(r).toHaveLength(0);
  });
});

// M-3: o badge de canal usava só o espelho `anuncios_externos`, que pode estar furado — produto
// com ml_item_id preenchido mas sem linha no espelho não mostrava NENHUM badge, mesmo publicado.
describe('canaisEfetivos', () => {
  it('inclui mercado_livre por ml_item_id mesmo sem entrada no espelho', () => {
    const p = produto({ mlItemId: 'MLB123' });
    expect(canaisEfetivos(p, new Map())).toEqual(['mercado_livre']);
  });

  it('inclui mercado_livre por ml_item_id mesmo com mapa de canais undefined', () => {
    const p = produto({ mlItemId: 'MLB123' });
    expect(canaisEfetivos(p, undefined)).toEqual(['mercado_livre']);
  });

  it('não duplica mercado_livre quando já está no espelho', () => {
    const p = produto({ mlItemId: 'MLB123' });
    const canais = new Map([['00000001', ['mercado_livre']]]);
    expect(canaisEfetivos(p, canais)).toEqual(['mercado_livre']);
  });

  it('sem ml_item_id, devolve só o que está no espelho', () => {
    const p = produto();
    expect(canaisEfetivos(p, new Map())).toEqual([]);
  });
});

describe('filtrarProdutos — ordenação', () => {
  const a = produto({ codigoPai: 'A', nomePai: 'Zinco', saldoTotal: 1, criadoEm: '2026-01-01T00:00:00Z' });
  const b = produto({ codigoPai: 'B', nomePai: 'Abacate', saldoTotal: 9, criadoEm: '2026-08-01T00:00:00Z' });

  it('nome ordena alfabeticamente em pt-BR', () => {
    expect(filtrarProdutos([a, b], { ...base, termo: '', ordem: 'nome' }).map((p) => p.nomePai)).toEqual(['Abacate', 'Zinco']);
  });

  it('saldo-asc põe o menor saldo primeiro', () => {
    expect(filtrarProdutos([b, a], { ...base, termo: '', ordem: 'saldo-asc' }).map((p) => p.saldoTotal)).toEqual([1, 9]);
  });

  it('recente põe o mais novo primeiro', () => {
    expect(filtrarProdutos([a, b], { ...base, termo: '', ordem: 'recente' }).map((p) => p.codigoPai)).toEqual(['B', 'A']);
  });
});
