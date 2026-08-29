import { describe, expect, it } from 'vitest';
import {
  capitalDoLote,
  montarCenariosDre,
  precosDosCenarios,
  type CotacaoPorPreco,
} from '../dre-cenarios';
import type { Tarifa } from '../tarifa';

// ADR-0149: cinco PREÇOS de venda, cada um com a SUA cotação. Nada é extrapolado — comissão e
// frete do ML têm degraus por faixa, e reaproveitar a cotação de outro preço erra com aparência
// de precisão (Spike 040).

const tarifa = (comissao: number, frete: number, over: Partial<Tarifa> = {}): Tarifa => ({
  classico: { comissao, percentual: 14, fixa: 0, imposto: 0, recebe: 0 },
  premium: { comissao: comissao * 1.3, percentual: 18, fixa: 0, imposto: 0, recebe: 0 },
  frete,
  proveniencia: 'official',
  ...over,
});

describe('precosDosCenarios', () => {
  const base = {
    maisBarato: 59.9,
    medioDoNicho: 84.5,
    anuncioQueMaisVende: 89.9,
    precoAlvo: 110,
    pontoEquilibrio: 71.2,
  };

  it('devolve os cinco na ordem do mais barato ao mais caro, com rótulo e natureza', () => {
    const cs = precosDosCenarios(base);
    expect(cs).toHaveLength(5);
    expect(cs.map((c) => c.preco)).toEqual([59.9, 71.2, 84.5, 89.9, 110]);
    expect(cs.find((c) => c.chave === 'preco_alvo')!.projecao).toBe(true);
    expect(cs.find((c) => c.chave === 'ponto_equilibrio')!.projecao).toBe(true);
    expect(cs.find((c) => c.chave === 'mais_barato')!.projecao).toBe(false);
  });

  // Critério de aceite 1: o buy-box não é obtenível (Spike 049) e não pode aparecer.
  it('nenhum rótulo menciona buy-box', () => {
    expect(JSON.stringify(precosDosCenarios(base))).not.toMatch(/buy.?box/i);
  });

  it('preço ausente é omitido, não vira zero', () => {
    const cs = precosDosCenarios({ ...base, medioDoNicho: null, precoAlvo: null });
    expect(cs).toHaveLength(3);
    expect(cs.every((c) => c.preco > 0)).toBe(true);
  });

  it('preços iguais não viram duas linhas', () => {
    const cs = precosDosCenarios({ ...base, medioDoNicho: 89.9 });
    expect(cs.filter((c) => c.preco === 89.9)).toHaveLength(1);
  });
});

describe('montarCenariosDre', () => {
  const entradaBase = {
    custoProduto: 42,
    origem: 'nacional' as const,
    aliquotas: { nacional: 8, importado: 16 },
  };

  // Critério 2: cada cenário usa a cotação DO SEU preço.
  it('usa a cotação de cada preço, não a de outro', () => {
    const cotacoes: CotacaoPorPreco[] = [
      { preco: 59.9, tarifa: tarifa(8.39, 0) },      // abaixo do limite: comprador paga o frete
      { preco: 89.9, tarifa: tarifa(12.59, 8.45) },  // acima: vendedor absorve
    ];
    const r = montarCenariosDre(
      precosDosCenarios({ maisBarato: 59.9, medioDoNicho: null, anuncioQueMaisVende: 89.9, precoAlvo: null, pontoEquilibrio: null }),
      cotacoes,
      entradaBase,
    );
    const barato = r.find((c) => c.chave === 'mais_barato')!;
    const caro = r.find((c) => c.chave === 'anuncio_que_mais_vende')!;
    expect(barato.dre.estado).toBe('calculada');
    expect(caro.dre.estado).toBe('calculada');
    if (barato.dre.estado !== 'calculada' || caro.dre.estado !== 'calculada') return;
    // O frete difere porque a FAIXA difere — é exatamente o que a extrapolação errava.
    expect(barato.dre.frete).toBe(0);
    expect(caro.dre.frete).toBe(8.45);
  });

  // Critério 3: um cenário que recusa não derruba os outros.
  it('cotação não-oficial recusa só a própria linha', () => {
    const cotacoes: CotacaoPorPreco[] = [
      { preco: 59.9, tarifa: tarifa(8.39, 0, { proveniencia: 'partial', motivo_proveniencia: 'pacote padrão' }) },
      { preco: 89.9, tarifa: tarifa(12.59, 8.45) },
    ];
    const r = montarCenariosDre(
      precosDosCenarios({ maisBarato: 59.9, medioDoNicho: null, anuncioQueMaisVende: 89.9, precoAlvo: null, pontoEquilibrio: null }),
      cotacoes,
      entradaBase,
    );
    expect(r.find((c) => c.chave === 'mais_barato')!.dre.estado).toBe('indisponivel');
    expect(r.find((c) => c.chave === 'anuncio_que_mais_vende')!.dre.estado).toBe('calculada');
  });

  it('preço sem cotação recusa dizendo que faltou a cotação', () => {
    const r = montarCenariosDre(
      precosDosCenarios({ maisBarato: 59.9, medioDoNicho: null, anuncioQueMaisVende: null, precoAlvo: null, pontoEquilibrio: null }),
      [],
      entradaBase,
    );
    expect(r[0].dre.estado).toBe('indisponivel');
  });
});

describe('capitalDoLote', () => {
  // Critério 5: quantidade em branco não vira 1.
  it('sem quantidade não há capital nem lucro de lote', () => {
    expect(capitalDoLote(null, 42, 19.67)).toBeNull();
    expect(capitalDoLote(0, 42, 19.67)).toBeNull();
  });

  it('com quantidade devolve o que sai do caixa e o que volta', () => {
    const c = capitalDoLote(100, 42, 19.67)!;
    expect(c.capitalImobilizado).toBe(4200);
    expect(c.lucroTotal).toBe(1967);
  });

  // Critério 6 / D-4: a quantidade NÃO muda o percentual — ele é o markup, e é rotulado assim.
  it('o percentual é idêntico com qualquer quantidade — é o retorno sobre o custo', () => {
    const um = capitalDoLote(1, 42, 19.67)!;
    const mil = capitalDoLote(1000, 42, 19.67)!;
    expect(um.retornoSobreCustoPct).toBeCloseTo(mil.retornoSobreCustoPct!, 10);
    expect(um.retornoSobreCustoPct).toBeCloseTo(46.83, 2);
  });

  it('custo zero não gera divisão por zero', () => {
    expect(capitalDoLote(10, 0, 5)!.retornoSobreCustoPct).toBeNull();
  });

  it('lucro negativo devolve capital travado e prejuízo do lote', () => {
    const c = capitalDoLote(50, 42, -3.1)!;
    expect(c.capitalImobilizado).toBe(2100);
    expect(c.lucroTotal).toBe(-155);
  });
});
