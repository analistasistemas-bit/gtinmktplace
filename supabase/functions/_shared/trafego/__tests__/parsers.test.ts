import { describe, expect, it } from 'vitest';
import { parseSalePrice, parseVisitas } from '../parsers.ts';
import esparso from './fixtures/visits-150-esparso.json';
import ending from './fixtures/visits-10-ending-2026-09-20.json';
import pausadoVazio from './fixtures/visits-150-pausado-vazio.json';
import comPromocao from './fixtures/sale-price-com-promocao.json';
import semPromocao from './fixtures/sale-price-sem-promocao.json';

const AGORA = new Date('2026-09-27T08:05:00Z'); // instante real do spike 052

describe('parseVisitas — fixtures reais (spike 052)', () => {
  it('esparso: preenche os dias omitidos com 0/ok; soma bate com total_visits', () => {
    const pontos = parseVisitas(esparso, 'brt', AGORA, { desde: '2026-04-30', ate: '2026-09-27' });
    expect(pontos).not.toBeNull();
    expect(pontos).toHaveLength(151);
    expect(pontos!.reduce((s, p) => s + p.visitas, 0)).toBe(esparso.total_visits);
    // ordenado
    expect(pontos!.map((p) => p.dia)).toEqual([...pontos!].map((p) => p.dia).sort());
  });

  it('esparso: só os dias a menos de 48h do fim ficam pendente (hoje, ontem e antontem)', () => {
    const pontos = parseVisitas(esparso, 'brt', AGORA, { desde: '2026-04-30', ate: '2026-09-27' });
    const pendentes = pontos!.filter((p) => p.estado === 'pendente').map((p) => p.dia);
    expect(pendentes).toEqual(['2026-09-25', '2026-09-26', '2026-09-27']);
  });

  it('esparso: dia estabilizado (≥48h) fica ok com o valor real; pendente mantém o valor', () => {
    const pontos = parseVisitas(esparso, 'brt', AGORA, { desde: '2026-04-30', ate: '2026-09-27' });
    const porDia = new Map(pontos!.map((p) => [p.dia, p]));
    expect(porDia.get('2026-09-24')).toEqual({ dia: '2026-09-24', visitas: expect.any(Number), estado: 'ok' });
    expect(porDia.get('2026-09-26')).toEqual({ dia: '2026-09-26', visitas: 179, estado: 'pendente' });
    expect(porDia.get('2026-09-27')).toEqual({ dia: '2026-09-27', visitas: 3, estado: 'pendente' });
  });

  it('esparso: dia dentro da janela e ausente na resposta = 0 visitas, estado ok', () => {
    const pontos = parseVisitas(esparso, 'brt', AGORA, { desde: '2026-04-30', ate: '2026-09-27' });
    const porDia = new Map(pontos!.map((p) => [p.dia, p]));
    expect(porDia.get('2026-05-02')).toEqual({ dia: '2026-05-02', visitas: 0, estado: 'ok' });
  });

  it('ending: 11 dias ascendentes, soma bate com total_visits (last=10 → N+1 dias)', () => {
    const pontos = parseVisitas(ending, 'brt', new Date('2026-10-05T00:00:00Z'), { desde: '2026-09-10', ate: '2026-09-20' });
    expect(pontos).toHaveLength(11);
    expect(pontos!.every((p) => p.estado === 'ok')).toBe(true);
    expect(pontos!.map((p) => p.dia)).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14',
      '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
    ]);
    expect(pontos!.reduce((s, p) => s + p.visitas, 0)).toBe(ending.total_visits);
  });

  it('pausado-vazio: results vazio → todo dia da janela é 0 (os últimos 3 pendentes)', () => {
    const pontos = parseVisitas(pausadoVazio, 'brt', AGORA, { desde: '2026-04-30', ate: '2026-09-27' });
    expect(pontos).toHaveLength(151);
    expect(pontos!.every((p) => p.visitas === 0)).toBe(true);
    expect(pontos!.filter((p) => p.estado === 'pendente').map((p) => p.dia)).toEqual([
      '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
  });

  it('calendario utc muda o instante em que o dia termina (borda das 48h)', () => {
    // Dia 2026-09-24 termina em 2026-09-25T03:00Z (brt) ou T00:00Z (utc) — 3h de diferença.
    // agora = 2026-09-27T00:00:00Z está a exatamente 48h do fim utc (→ ok) e a 45h do fim brt
    // (→ ainda pendente): o mesmo instante separa os dois calendários.
    const janela = { desde: '2026-09-24', ate: '2026-09-24' };
    const respostaZero = { results: [] };
    const agora = new Date('2026-09-27T00:00:00Z');
    expect(parseVisitas(respostaZero, 'brt', agora, janela)![0].estado).toBe('pendente');
    expect(parseVisitas(respostaZero, 'utc', agora, janela)![0].estado).toBe('ok');
  });

  it('resposta malformada nunca lança: null em cada caso', () => {
    const janela = { desde: '2026-09-01', ate: '2026-09-02' };
    expect(parseVisitas(null, 'brt', AGORA, janela)).toBeNull();
    expect(parseVisitas({}, 'brt', AGORA, janela)).toBeNull();
    expect(parseVisitas({ results: 'x' }, 'brt', AGORA, janela)).toBeNull();
    expect(parseVisitas({ results: [{ date: '2026-09-01T00:00:00Z' }] }, 'brt', AGORA, janela)).toBeNull();
    expect(parseVisitas({ results: [{ date: 'não é data', total: 1 }] }, 'brt', AGORA, janela)).toBeNull();
    expect(parseVisitas({ results: [{ date: '2026-09-01T00:00:00Z', total: 'x' }] }, 'brt', AGORA, janela)).toBeNull();
    // duplicado: mesmo dia duas vezes é dado não confiável
    expect(parseVisitas({
      results: [
        { date: '2026-09-01T00:00:00Z', total: 1 },
        { date: '2026-09-01T00:00:00Z', total: 2 },
      ],
    }, 'brt', AGORA, janela)).toBeNull();
    expect(parseVisitas({ results: [] }, 'brt', new Date('não é data'), janela)).toBeNull();
    expect(parseVisitas({ results: [] }, 'brt', AGORA, { desde: '2026-09-05', ate: '2026-09-01' })).toBeNull();
  });
});

describe('parseSalePrice — fixtures reais (spike 052)', () => {
  it('com promoção: amount é o preço "por", regular_amount o "de"', () => {
    expect(parseSalePrice(comPromocao)).toEqual({ preco: 12.69, precoRegular: 14.1, moeda: 'BRL' });
  });

  it('sem promoção: regular_amount null vira precoRegular null', () => {
    expect(parseSalePrice(semPromocao)).toEqual({ preco: 65.9, precoRegular: null, moeda: 'BRL' });
  });

  it('malformada nunca lança: null quando amount ausente, negativo ou não numérico', () => {
    expect(parseSalePrice(null)).toBeNull();
    expect(parseSalePrice({})).toBeNull();
    expect(parseSalePrice({ amount: 'x', currency_id: 'BRL' })).toBeNull();
    expect(parseSalePrice({ amount: -1, currency_id: 'BRL' })).toBeNull();
    expect(parseSalePrice({ amount: 10 })).toBeNull(); // sem moeda: nunca defaultar (financeiro)
  });
});
