import { describe, it, expect } from 'vitest';
import { gruposDePreco, alvosAplicarPreco, exigeDivisaoUpdate, configGrupoPendente } from '../grupos-preco';
import type { Variacao } from '../tipos-dominio';

const v = (codigo: string, over: Partial<Variacao> = {}): Variacao => ({
  id: codigo,
  codigo,
  cor: 'Azul',
  corHex: '#00f',
  corOrigem: null,
  corEditadaPeloOperador: false,
  preco: 8,
  precoPublicacao: 10,
  precoPublicadoMl: null,
  estoque: 5,
  gtin: null,
  excluidaDaPublicacao: false,
  mlVariationId: null,
  estoqueAnterior: null,
  custo: null,
  pesoGramas: null,
  alturaCm: null,
  larguraCm: null,
  comprimentoCm: null,
  exibirComDesconto: null,
  descontoPct: null,
  atacado: null,
  ...over,
});

describe('gruposDePreco', () => {
  it('uniforme → 1 grupo com todas as incluídas', () => {
    const g = gruposDePreco({ variacoes: [v('A'), v('B')] });
    expect(g).toHaveLength(1);
    expect(g[0].preco).toBe(10);
    expect(g[0].variacoes).toHaveLength(2);
  });
  it('2 preços → 2 grupos ordenados do menor para o maior; excluídas ficam de fora', () => {
    const g = gruposDePreco({
      variacoes: [v('A'), v('B', { precoPublicacao: 12 }), v('X', { excluidaDaPublicacao: true, precoPublicacao: 99 })],
    });
    expect(g.map((x) => x.preco)).toEqual([10, 12]);
  });
  it('sem precoPublicacao usa o preco da planilha (mesma regra dos controles atuais)', () => {
    const g = gruposDePreco({ variacoes: [v('A', { precoPublicacao: null })] });
    expect(g[0].preco).toBe(8);
  });
});

describe('alvosAplicarPreco', () => {
  const vars = [v('A'), v('B'), v('C', { precoPublicacao: 12 })];
  it('"Sim, aplicar a todas": a editada + toda variação com preço diferente do novo', () => {
    const alvos = alvosAplicarPreco(vars, 'A', true, 12);
    expect(alvos.map((x) => x.codigo).sort()).toEqual(['A', 'B']); // C já está em 12
  });
  it('"Não, só esta": só a editada', () => {
    expect(alvosAplicarPreco(vars, 'A', false, 12).map((x) => x.codigo)).toEqual(['A']);
  });
  it('sujeira de ponto flutuante não entra nos alvos (round2, não !==)', () => {
    const varsComSujeira = [v('A'), v('B', { precoPublicacao: 12.000000000000002 })];
    expect(alvosAplicarPreco(varsComSujeira, 'A', true, 12).map((x) => x.codigo)).toEqual(['A']);
  });
});

describe('exigeDivisaoUpdate', () => {
  it('CREATE nunca exige divisão', () => {
    expect(exigeDivisaoUpdate({ operacao: 'CREATE', variacoes: [v('A')] })).toBe(false);
  });
  it('UPDATE: variações do MESMO anúncio (mesmo precoPublicadoMl) indo a preços distintos → true', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 10 }),
        v('B', { mlVariationId: 'm2', precoPublicadoMl: 10, precoPublicacao: 12 }),
      ],
    })).toBe(true);
  });
  it('UPDATE: anúncio inteiro repreçado junto (uniforme) → false', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 12 }),
        v('B', { mlVariationId: 'm2', precoPublicadoMl: 10, precoPublicacao: 12 }),
      ],
    })).toBe(false);
  });
  it('UPDATE: faixas distintas já publicadas (split no ar), cada uma uniforme no seu preço → false', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 10 }),
        v('B', { mlVariationId: 'm2', precoPublicadoMl: 15, precoPublicacao: 15 }),
      ],
    })).toBe(false);
  });
  it('cor nova (precoPublicadoMl null) e excluídas não contam', () => {
    expect(exigeDivisaoUpdate({
      operacao: 'UPDATE',
      variacoes: [
        v('A', { mlVariationId: 'm1', precoPublicadoMl: 10, precoPublicacao: 10 }),
        v('N', { precoPublicacao: 20 }),
        v('X', { mlVariationId: 'm3', precoPublicadoMl: 10, precoPublicacao: 99, excluidaDaPublicacao: true }),
      ],
    })).toBe(false);
  });
});

describe('configGrupoPendente', () => {
  const grupo = (vars: Variacao[]) => ({ preco: 10, variacoes: vars });
  it('família com desconto ativo + variação sem confirmação explícita → pendente', () => {
    expect(configGrupoPendente({ exibirComDesconto: true, atacado: null }, grupo([v('A')]))).toBe(true);
  });
  it('família com atacado ativo + variação sem atacado explícito → pendente', () => {
    expect(configGrupoPendente(
      { exibirComDesconto: false, atacado: [{ min_unidades: 5, desconto_pct: 5 }] },
      grupo([v('A')]),
    )).toBe(true);
  });
  it('tudo confirmado explicitamente (mesmo que desligado) → não pendente', () => {
    expect(configGrupoPendente(
      { exibirComDesconto: true, atacado: [{ min_unidades: 5, desconto_pct: 5 }] },
      grupo([v('A', { exibirComDesconto: false, atacado: [] })]),
    )).toBe(false);
  });
  it('família sem nada ativo → nunca pendente', () => {
    expect(configGrupoPendente({ exibirComDesconto: false, atacado: null }, grupo([v('A')]))).toBe(false);
  });
});
