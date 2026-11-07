import { describe, expect, it } from 'vitest';
import { maiorOferta, oferta, unirOfertas } from '../ofertas.ts';
import type { OfertaVigente } from '../tipos.ts';

const o = (chave: string, preco: number | null): OfertaVigente => ({
  chave, promocao_id: 'P', tipo: 'DEAL', status: 'started', preco, offer_id: chave, inicio: null, fim: null,
});

describe('oferta', () => {
  const base = { promocao_id: 'P', tipo: 'LIGHTNING', status: 'pending' as const, preco: 19, fim: null };

  it('chave: offer_id; sem ele, promoção + início; sem início, promoção + status', () => {
    expect(oferta({ ...base, offer_id: 'OFFER-1', inicio: '2026-11-06' }).chave).toBe('OFFER-1');
    expect(oferta({ ...base, offer_id: null, inicio: '2026-11-06' }).chave).toBe('P:2026-11-06');
    expect(oferta({ ...base, offer_id: null, inicio: null }).chave).toBe('P:pending');
  });
});

describe('unirOfertas', () => {
  it('fonte inconclusiva → null, nunca "sem ofertas"', () => {
    expect(unirOfertas([null, [o('A', 39.9)]])).toBeNull();
  });

  it('o sync vê a oferta e o ML ainda não', () => {
    expect(unirOfertas([[], [o('A', 39.9)]])).toEqual([o('A', 39.9)]);
  });

  it('mesma chave: o maior preço vence, em qualquer ordem', () => {
    expect(unirOfertas([[o('A', 38)], [o('A', 39.9)]])).toEqual([o('A', 39.9)]);
    expect(unirOfertas([[o('A', 39.9)], [o('A', 38)]])).toEqual([o('A', 39.9)]);
  });

  it('mesma chave: preço nulo vence, em qualquer ordem', () => {
    expect(unirOfertas([[o('A', 38)], [o('A', null)]])).toEqual([o('A', null)]);
    expect(unirOfertas([[o('A', null)], [o('A', 38)]])).toEqual([o('A', null)]);
  });

  it('mesma chave: started vence pending no empate de preço, em qualquer ordem', () => {
    const pendente = { ...o('A', 39.9), status: 'pending' as const };
    expect(unirOfertas([[pendente], [o('A', 39.9)]])).toEqual([o('A', 39.9)]);
    expect(unirOfertas([[o('A', 39.9)], [pendente]])).toEqual([o('A', 39.9)]);
  });

  it('mesma chave: started vence mesmo quando o preço vem do registro pending', () => {
    const maior = { ...o('A', 45), status: 'pending' as const };
    const semPreco = { ...o('A', null), status: 'pending' as const };
    expect(unirOfertas([[o('A', 39.9)], [maior]])).toEqual([o('A', 45)]);
    expect(unirOfertas([[maior], [o('A', 39.9)]])).toEqual([o('A', 45)]);
    expect(unirOfertas([[o('A', 39.9)], [semPreco]])).toEqual([o('A', null)]);
    expect(unirOfertas([[semPreco], [o('A', 39.9)]])).toEqual([o('A', null)]);
  });

  it('mesma chave nas duas fontes como pending continua pending', () => {
    const pendente = { ...o('A', 39.9), status: 'pending' as const };
    expect(unirOfertas([[pendente], [pendente]])).toEqual([pendente]);
  });

  it('mesma campanha, ofertas distintas', () => {
    expect(unirOfertas([[o('A', 19)], [o('B', 24)]])?.length).toBe(2);
  });
});

describe('maiorOferta', () => {
  it('maior preço', () => {
    expect(maiorOferta([o('A', 19), o('B', 24.22)])).toBe(24.22);
  });

  it('alguma oferta sem preço → null', () => {
    expect(maiorOferta([o('A', null)])).toBeNull();
    expect(maiorOferta([o('A', 19), o('B', null)])).toBeNull();
  });
});
