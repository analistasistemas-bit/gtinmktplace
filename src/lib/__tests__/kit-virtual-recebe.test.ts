import { describe, expect, it } from 'vitest';
import { recebeAvulso, somaRecebeAvulso } from '../kit-virtual-recebe';
import type { Tarifa } from '../tarifa';

const tipo = (recebe: number) => ({ comissao: 10, percentual: 14, fixa: 0, imposto: 8, recebe });
const tarifa = (over: Partial<Tarifa> = {}): Tarifa => ({
  classico: tipo(60), premium: tipo(55), frete: 0, proveniencia: 'official', ...over,
});
const base = { tarifa: tarifa(), listingTypeId: 'gold_special', aliquotaPct: 8, custo: 40, preco: 100 };

describe('somaRecebeAvulso', () => {
  it('soma recebe × quantidade', () => {
    expect(somaRecebeAvulso([{ recebe: 50, quantidade: 2 }, { recebe: 30.5, quantidade: 1 }])).toBe(130.5);
  });
  it('null se alguma linha é null', () => {
    expect(somaRecebeAvulso([{ recebe: 50, quantidade: 2 }, { recebe: null, quantidade: 1 }])).toBeNull();
  });
});

describe('recebeAvulso', () => {
  it('com custo: recebe do Clássico, lucro e margem', () => {
    expect(recebeAvulso(base)).toEqual({ estado: 'ok', recebe: 60, lucro: 20, margemPct: 20 });
  });
  it('sem custo: recebe numérico e lucro null', () => {
    expect(recebeAvulso({ ...base, custo: null })).toEqual({ estado: 'ok', recebe: 60, lucro: null, margemPct: null });
  });
  it('gold_pro usa o bloco premium', () => {
    expect(recebeAvulso({ ...base, listingTypeId: 'gold_pro' }).recebe).toBe(55);
  });
  it('listing type desconhecido ou nulo: sem_listing_type, sem número', () => {
    for (const l of [null, 'free']) {
      expect(recebeAvulso({ ...base, listingTypeId: l })).toMatchObject({ estado: 'sem_listing_type', recebe: null });
    }
  });
  it('alíquota nula: sem_aliquota, sem número', () => {
    expect(recebeAvulso({ ...base, aliquotaPct: null })).toMatchObject({ estado: 'sem_aliquota', recebe: null });
  });
  it('tarifa cotando, nula ou não oficial', () => {
    expect(recebeAvulso({ ...base, tarifa: undefined }).estado).toBe('calculando');
    expect(recebeAvulso({ ...base, tarifa: null }).estado).toBe('indisponivel');
    expect(recebeAvulso({ ...base, tarifa: tarifa({ proveniencia: 'estimated' }) })).toMatchObject({ estado: 'indisponivel', recebe: null });
  });
});
