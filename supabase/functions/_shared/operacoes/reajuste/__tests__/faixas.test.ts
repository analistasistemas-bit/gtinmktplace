import { describe, expect, it } from 'vitest';
import { configDoMlb, decidirFaixas, faixasDoAlvo, faixasValidas, mesmasFaixas } from '../faixas.ts';

const CINCO = [{ min_unidades: 2, desconto_pct: 5 }];
const CRUZA = 'Faixa de atacado ficaria acima do preço base';

describe('faixasDoAlvo', () => {
  it('% sobre o alvo, em centavos half-up', () => {
    expect(faixasDoAlvo(100, CINCO)).toEqual([{ min_unidades: 2, preco: 95 }]);
    expect(faixasDoAlvo(10.01, CINCO)).toEqual([{ min_unidades: 2, preco: 9.51 }]); // 9,5095
  });
  it('ordena por quantidade', () => {
    expect(faixasDoAlvo(100, [{ min_unidades: 5, desconto_pct: 10 }, ...CINCO]).map((f) => f.min_unidades)).toEqual([2, 5]);
  });
  it('desconto de 100% vira 0, que faixasValidas recusa', () => {
    expect(faixasDoAlvo(100, [{ min_unidades: 2, desconto_pct: 100 }])).toEqual([{ min_unidades: 2, preco: 0 }]);
  });
});

describe('faixasValidas', () => {
  const f = (min_unidades: number, preco: number) => ({ min_unidades, preco });
  it('sem faixas é válido', () => expect(faixasValidas(100, [])).toBe(true));
  it('abaixo do base, > 0, crescente', () => expect(faixasValidas(100, [f(2, 99.99), f(3, 90)])).toBe(true));
  it('igual ao base', () => expect(faixasValidas(100, [f(2, 100)])).toBe(false));
  it('acima do base', () => expect(faixasValidas(100, [f(2, 100.01)])).toBe(false));
  it('zero', () => expect(faixasValidas(100, [f(2, 0)])).toBe(false));
  it('menos de 2 unidades', () => expect(faixasValidas(100, [f(1, 90)])).toBe(false));
  it('unidades não crescentes', () => {
    expect(faixasValidas(100, [f(3, 90), f(2, 95)])).toBe(false);
    expect(faixasValidas(100, [f(2, 90), f(2, 95)])).toBe(false);
  });
  it('mais de 5', () => expect(faixasValidas(100, [2, 3, 4, 5, 6, 7].map((n) => f(n, 90)))).toBe(false));
  it('5 faixas', () => expect(faixasValidas(100, [2, 3, 4, 5, 6].map((n) => f(n, 90)))).toBe(true));
});

describe('mesmasFaixas', () => {
  const a = { min_unidades: 2, preco: 95 }, b = { min_unidades: 5, preco: 90 };
  it('não depende da ordem', () => expect(mesmasFaixas([a, b], [b, a])).toBe(true));
  it('compara em centavos', () => expect(mesmasFaixas([{ min_unidades: 2, preco: 0.1 + 0.2 }], [{ min_unidades: 2, preco: 0.3 }])).toBe(true));
  it('preço diferente', () => expect(mesmasFaixas([a], [{ ...a, preco: 95.01 }])).toBe(false));
  it('quantidade diferente', () => expect(mesmasFaixas([a], [{ ...a, min_unidades: 3 }])).toBe(false));
  it('tamanho diferente', () => expect(mesmasFaixas([a], [a, b])).toBe(false));
});

describe('configDoMlb', () => {
  it('nada configurado → null', () => {
    expect(configDoMlb([{ atacado: null }], { atacado: null })).toEqual({ faixas: null, divergente: false });
  });
  it('null herda a família', () => {
    expect(configDoMlb([{ atacado: null }, { atacado: null }], { atacado: CINCO })).toEqual({ faixas: CINCO, divergente: false });
  });
  it('[] é sem atacado, não herda', () => {
    expect(configDoMlb([{ atacado: [] }], { atacado: CINCO })).toEqual({ faixas: [], divergente: false });
  });
  it('cor igual à família não diverge, em qualquer ordem', () => {
    const duas = [{ min_unidades: 2, desconto_pct: 5 }, { min_unidades: 5, desconto_pct: 10 }];
    expect(configDoMlb([{ atacado: null }, { atacado: [...duas].reverse() }], { atacado: duas }).divergente).toBe(false);
  });
  it('cores diferentes divergem', () => {
    expect(configDoMlb([{ atacado: null }, { atacado: [{ min_unidades: 2, desconto_pct: 9 }] }], { atacado: CINCO }))
      .toEqual({ faixas: null, divergente: true });
  });
  it('uma cor sem atacado e outra com diverge', () => {
    expect(configDoMlb([{ atacado: [] }, { atacado: null }], { atacado: CINCO }).divergente).toBe(true);
  });
  it('sem configuração e [] são ambos "sem atacado": não diverge, e [] prevalece', () => {
    expect(configDoMlb([{ atacado: null }, { atacado: [] }], { atacado: null })).toEqual({ faixas: [], divergente: false });
  });
});

describe('decidirFaixas', () => {
  const viva = (preco: number) => [{ min_unidades: 2, preco }];
  const cfg = (faixas: typeof CINCO | null, divergente = false) => ({ faixas, divergente });

  it('sem faixas e sem configuração', () => {
    expect(decidirFaixas(90, [], null)).toEqual({ acao: 'nenhuma', faixas_alvo: null });
    expect(decidirFaixas(90, [], cfg(null))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
  });
  it('com configuração recalcula sobre o alvo', () => {
    expect(decidirFaixas(90, viva(95), cfg(CINCO))).toEqual({ acao: 'recalcular', faixas_alvo: [{ min_unidades: 2, preco: 85.5 }] });
  });
  it('faixa viva já no alvo → nada a gravar', () => {
    expect(decidirFaixas(90, viva(85.5), cfg(CINCO))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
  });
  it('faixa viva sem configuração: subir mantém', () => {
    expect(decidirFaixas(120, viva(95), null)).toEqual({ acao: 'nenhuma', faixas_alvo: null });
  });
  it('faixa viva sem configuração: descer sem cruzar mantém', () => {
    expect(decidirFaixas(96, viva(95), cfg(null))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
  });
  it('faixa viva sem configuração: descer cruzando ou encostando → fora', () => {
    expect(decidirFaixas(90, viva(95), null)).toEqual({ acao: 'fora', motivo: CRUZA });
    expect(decidirFaixas(95, viva(95), null)).toEqual({ acao: 'fora', motivo: CRUZA });
  });
  it('a ordem das faixas vivas não esconde a que cruza', () => {
    expect(decidirFaixas(92, [{ min_unidades: 5, preco: 90 }, { min_unidades: 2, preco: 95 }], null)).toEqual({ acao: 'fora', motivo: CRUZA });
  });
  it('configuração divergente → fora, mesmo sem faixa viva', () => {
    const fora = { acao: 'fora', motivo: 'Atacado diferente entre cores — ajuste na Revisão' };
    expect(decidirFaixas(90, viva(85), cfg(null, true))).toEqual(fora);
    expect(decidirFaixas(90, [], cfg(null, true))).toEqual(fora);
  });
  it('[] com faixa viva: mantém, como sem configuração', () => {
    expect(decidirFaixas(90, viva(85), cfg([]))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
    expect(decidirFaixas(120, viva(95), cfg([]))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
  });
  it('[] com faixa viva cruzando → fora', () => {
    expect(decidirFaixas(90, viva(95), cfg([]))).toEqual({ acao: 'fora', motivo: CRUZA });
  });
  it('configuração sem faixa viva: não cria faixas', () => {
    expect(decidirFaixas(90, [], cfg(CINCO))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
  });
  it('quantidades diferentes da configuração: não apaga nem cria faixa, mantém as vivas', () => {
    const duas = [{ min_unidades: 2, preco: 85 }, { min_unidades: 10, preco: 80 }];
    expect(decidirFaixas(90, duas, cfg(CINCO))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
    expect(decidirFaixas(82, duas, cfg(CINCO))).toEqual({ acao: 'fora', motivo: CRUZA });
  });
  it('ordem das faixas vivas não muda o casamento com a configuração', () => {
    const config = [{ min_unidades: 2, desconto_pct: 5 }, { min_unidades: 10, desconto_pct: 10 }];
    const vivas = [{ min_unidades: 10, preco: 90 }, { min_unidades: 2, preco: 95 }];
    expect(decidirFaixas(50, vivas, cfg(config))).toEqual({
      acao: 'recalcular', faixas_alvo: [{ min_unidades: 2, preco: 47.5 }, { min_unidades: 10, preco: 45 }],
    });
  });
  it('[] sem faixa viva → nada', () => {
    expect(decidirFaixas(90, [], cfg([]))).toEqual({ acao: 'nenhuma', faixas_alvo: null });
  });
  it('configuração que não forma faixa válida → fora, sem gravar', () => {
    const r = decidirFaixas(1, viva(0.5), cfg([{ min_unidades: 2, desconto_pct: 0.1 }])); // R$ 1,00 com 0,1% = R$ 1,00
    expect(r).toEqual({ acao: 'fora', motivo: 'Faixa de atacado inválida para este preço — ajuste na Revisão' });
    expect(decidirFaixas(100, [{ min_unidades: 1, preco: 90 }], cfg([{ min_unidades: 1, desconto_pct: 5 }])).acao).toBe('fora');
  });
});
