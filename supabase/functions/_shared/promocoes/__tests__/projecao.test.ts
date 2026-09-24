import { describe, expect, it } from 'vitest';
import {
  ateQuantoDescer, contar, ehParticipando, liquidoNoPreco, piorSemaforo, precoAvaliado, semaforo,
} from '../projecao.ts';
import type { LinhaItem, Tarifa } from '../tipos.ts';

const t = (pct: number, fixa = 0, frete = 0): Tarifa => ({ comissao: { percentual: pct, fixa }, frete });

describe('semaforo', () => {
  it('verde no piso, amarelo entre custo e piso, vermelho abaixo do custo', () => {
    expect(semaforo(20, 20, 10)).toBe('verde');
    expect(semaforo(15, 20, 10)).toBe('amarelo');
    expect(semaforo(9.99, 20, 10)).toBe('vermelho');
    expect(semaforo(null, 20, 10)).toBe('indisponivel');
    expect(semaforo(5, 20, 0)).toBe('amarelo'); // custo 0 nunca vira vermelho (igual ao front)
  });
});

describe('piorSemaforo', () => {
  it('vermelho > amarelo > verde; indisponível só se nenhuma cor tem líquido', () => {
    expect(piorSemaforo(['verde', 'amarelo'])).toBe('amarelo');
    expect(piorSemaforo(['verde', 'indisponivel', 'vermelho'])).toBe('vermelho');
    expect(piorSemaforo(['verde', 'indisponivel'])).toBe('verde');
    expect(piorSemaforo(['indisponivel', 'indisponivel'])).toBe('indisponivel');
    expect(piorSemaforo([])).toBe('indisponivel');
  });
});

describe('precoAvaliado', () => {
  it('convidado: sugerido quando há faixa, senão o preço da promoção', () => {
    expect(precoAvaliado({ status: 'candidate', preco_sugerido: 49.9, preco_promo: 45 })).toBe(49.9);
    expect(precoAvaliado({ status: 'candidate', preco_sugerido: null, preco_promo: 45 })).toBe(45);
    expect(precoAvaliado({ status: 'candidate', preco_sugerido: null, preco_promo: null })).toBeNull();
  });
  it('participando (no ar ou inscrito em campanha futura): o preço escolhido', () => {
    expect(precoAvaliado({ status: 'started', preco_sugerido: 49.9, preco_promo: 45 })).toBe(45);
    expect(precoAvaliado({ status: 'pending', preco_sugerido: 49.9, preco_promo: 45 })).toBe(45);
    expect(ehParticipando('candidate')).toBe(false);
    expect(ehParticipando('finished')).toBe(false);
  });
});

describe('liquidoNoPreco', () => {
  it('preço − comissão% − fixa − frete − imposto (mesma conta do liquidoClassico)', () => {
    // 100 − 12 − 6,25 − 20 − 8 = 53,75
    expect(liquidoNoPreco(100, t(12, 6.25, 20), 8)).toBeCloseTo(53.75, 10);
  });
});

describe('ateQuantoDescer', () => {
  const tarifaFixa = async () => t(10, 0, 0); // líquido = 0,82·P com imposto 8%

  it('"qualquer" quando o mínimo da faixa já atinge o piso', async () => {
    const r = await ateQuantoDescer({ piso: 20, aliquotaPct: 8, min: 30, max: 50 }, tarifaFixa);
    expect(r).toEqual({ valor: null, motivo: 'qualquer' });
  });

  it('"nenhum" quando nem o máximo atinge o piso', async () => {
    const r = await ateQuantoDescer({ piso: 100, aliquotaPct: 8, min: 30, max: 50 }, tarifaFixa);
    expect(r).toEqual({ valor: null, motivo: 'nenhum' });
  });

  it('menor preço da faixa com líquido ≥ piso, verificado na tarifa daquele preço', async () => {
    const r = await ateQuantoDescer({ piso: 30, aliquotaPct: 8, min: 20, max: 60 }, tarifaFixa);
    // grossUp(30, 10, 0, 0, 8) = 30/0,82 = 36,585… → arredonda p/ cima de 5 centavos = 36,60
    expect(r.motivo).toBeNull();
    expect(r.valor).toBeCloseTo(36.6, 2);
    expect(liquidoNoPreco(r.valor!, t(10), 8)).toBeGreaterThanOrEqual(30);
  });

  it('frete menor abaixo de R$ 79: desce até o mínimo real, não para no 1º preço válido', async () => {
    // frete 20 a partir de 79, 8 abaixo. Da tarifa do máximo: (30+20)/0,82 → 61,00 (válido, frete 8).
    // Refazendo com a tarifa de 61: (30+8)/0,82 = 46,34… → 46,35 — o mínimo real.
    const tarifa = async (p: number) => t(10, 0, p >= 79 ? 20 : 8);
    const r = await ateQuantoDescer({ piso: 30, aliquotaPct: 8, min: 20, max: 100 }, tarifa);
    expect(r.valor).toBeCloseTo(46.35, 2);
    expect(liquidoNoPreco(46.35, await tarifa(46.35), 8)).toBeGreaterThanOrEqual(30);
  });

  it('frete maior acima de R$ 40: fica acima do degrau quando abaixo dele não há preço válido', async () => {
    // abaixo de 40 precisaria de 34/0,82 = 41,46 (não existe < 40); a partir de 40: (34+10)/0,82 → 53,70
    const tarifa = async (p: number) => t(10, 0, p >= 40 ? 10 : 0);
    const r = await ateQuantoDescer({ piso: 34, aliquotaPct: 8, min: 20, max: 80 }, tarifa);
    expect(r.valor).toBeCloseTo(53.7, 2);
  });
});

describe('contar', () => {
  const linha = (status: string, pior: LinhaItem['pior_semaforo']) => ({ status, pior_semaforo: pior }) as LinhaItem;
  it('conta convidados, participando (started + pending) e o pior semáforo; outro status não conta', () => {
    expect(contar([
      linha('candidate', 'verde'), linha('candidate', 'indisponivel'),
      linha('started', 'vermelho'), linha('started', 'amarelo'), linha('pending', 'verde'), linha('finished', 'verde'),
    ])).toEqual({
      convidados: 2, convidados_verde: 1, participando: 3, verde: 2, amarelo: 1, vermelho: 1, indisponivel: 1,
      participando_vermelho: 1, ml_pct_max: null,
    });
  });

  it('ml_pct_max = maior parte bancada pelo ML entre os anúncios contados', () => {
    const l = (status: string, ml_pct: number | null) => ({ status, pior_semaforo: 'verde', ml_pct }) as LinhaItem;
    expect(contar([l('candidate', 30), l('started', 10), l('candidate', null)]).ml_pct_max).toBe(30);
    expect(contar([l('candidate', 0)]).ml_pct_max).toBeNull();
  });
});
