import { describe, it, expect } from 'vitest';
import { diffOfertas } from '../diff.ts';
import type { OfertaAnterior, OfertaColetada } from '../tipos.ts';

const oferta = (over: Partial<OfertaColetada> = {}): OfertaColetada => ({
  item_id: 'MLB1',
  seller_id: 1,
  preco: 100,
  tier: 'gold_special',
  frete_gratis: false,
  loja_oficial: false,
  ...over,
});
const anterior = (over: Partial<OfertaAnterior> = {}): OfertaAnterior => ({ ...oferta(), ativo: true, ...over });

describe('diffOfertas', () => {
  it('primeira coleta: grava tudo, 0 alertas', () => {
    const atuais = [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2', seller_id: 2 })];
    const r = diffOfertas([], atuais);
    expect(r.gravar).toEqual(atuais);
    expect(r.desativar).toEqual([]);
    expect(r.alertas).toEqual([]);
  });

  it('preço caiu (menor preço do produto): gravar + alerta preco_caiu com de/para', () => {
    const anteriores = [anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 80 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toEqual(atuais);
    expect(r.alertas).toContainEqual({ tipo: 'preco_caiu', payload: { de: 100, para: 80 } });
  });

  it('oferta nova: alerta novo_concorrente', () => {
    const anteriores = [anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const atuais = [
      oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 }),
      oferta({ item_id: 'MLB2', seller_id: 2, preco: 90 }),
    ];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toContainEqual(atuais[1]);
    expect(r.alertas).toContainEqual({
      tipo: 'novo_concorrente',
      payload: { item_id: 'MLB2', seller_id: 2, preco: 90 },
    });
  });

  it('oferta sumiu mas seller ainda presente (outro item): desativa, sem alerta concorrente_saiu', () => {
    const anteriores = [
      anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 }),
      anterior({ item_id: 'MLB2', seller_id: 1, preco: 110 }),
    ];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.desativar).toEqual([anteriores[1]]);
    expect(r.alertas.some((a) => a.tipo === 'concorrente_saiu')).toBe(false);
  });

  it('seller saiu de vez (nenhum item restante dele): alerta concorrente_saiu', () => {
    const anteriores = [
      anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 }),
      anterior({ item_id: 'MLB2', seller_id: 2, preco: 110 }),
    ];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.desativar).toEqual([anteriores[1]]);
    expect(r.alertas).toContainEqual({
      tipo: 'concorrente_saiu',
      payload: { item_id: 'MLB2', seller_id: 2 },
    });
  });

  it('nada mudou: gravar vazio, sem alertas', () => {
    const anteriores = [anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toEqual([]);
    expect(r.desativar).toEqual([]);
    expect(r.alertas).toEqual([]);
  });
});
