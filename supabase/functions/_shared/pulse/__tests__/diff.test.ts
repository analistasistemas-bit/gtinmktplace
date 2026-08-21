import { describe, it, expect } from 'vitest';
import { diffOfertas, entradaDiffRelevante } from '../diff.ts';
import type { OfertaAnterior, OfertaColetada } from '../tipos.ts';

const oferta = (over: Partial<OfertaColetada> = {}): OfertaColetada => ({
  item_id: 'MLB1',
  seller_id: 1,
  preco: 100,
  tier: 'gold_special',
  frete_gratis: false,
  loja_oficial: false,
  permalink: null,
  ...over,
});
const anterior = (over: Partial<OfertaAnterior> = {}): OfertaAnterior => ({ ...oferta(), ativo: true, ...over });
type OfertaQualificavelDiff = OfertaColetada & {
  transactions_total: number | null;
  visitas_30d: number | null;
  nivel: string | null;
};
const ofertaQualificavel = (
  over: Partial<OfertaQualificavelDiff> = {},
): OfertaQualificavelDiff => ({
  ...oferta(), transactions_total: 10, visitas_30d: 1, nivel: '3_yellow', ...over,
});
const anteriorQualificavel = (
  over: Partial<OfertaQualificavelDiff & { ativo: boolean }> = {},
): OfertaQualificavelDiff & { ativo: boolean } => ({ ...ofertaQualificavel(), ativo: true, ...over });

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

  // Sem isto, uma oferta de preço estável ficaria para sempre sem link, esperando uma mudança de
  // preço que pode nunca vir.
  it('link do anúncio aparecendo numa oferta estável faz gravar (backfill), sem alertar', () => {
    const anteriores = [anterior({ item_id: 'MLB1', preco: 100, permalink: null })];
    const atuais = [oferta({ item_id: 'MLB1', preco: 100, permalink: 'https://x/MLB-1' })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toHaveLength(1);
    expect(r.gravar[0].permalink).toBe('https://x/MLB-1');
    expect(r.alertas).toEqual([]);
  });

  // O diff isolado continua idempotente com links ausentes; na coleta real, o enriquecimento
  // anterior a esta etapa deriva o permalink do item_id.
  it('links ausentes nos dois lados não geram regravação em toda execução', () => {
    const anteriores = [anterior({ item_id: 'MLB1', preco: 100, permalink: null })];
    const atuais = [oferta({ item_id: 'MLB1', preco: 100, permalink: null })];
    expect(diffOfertas(anteriores, atuais).gravar).toEqual([]);
  });

  it('não alerta a entrada de oferta fora da referência', () => {
    const anteriores = entradaDiffRelevante([anteriorQualificavel({ item_id: 'MLB1' })]);
    const atuais = entradaDiffRelevante([
      ofertaQualificavel({ item_id: 'MLB1' }),
      ofertaQualificavel({ item_id: 'MLB2', seller_id: 2, transactions_total: 0 }),
    ]);

    expect(diffOfertas(anteriores, atuais).alertas).toEqual([]);
  });

  it('não alerta queda de preço causada por oferta fora da referência', () => {
    const anteriores = entradaDiffRelevante([anteriorQualificavel({ item_id: 'MLB1', preco: 100 })]);
    const atuais = entradaDiffRelevante([
      ofertaQualificavel({ item_id: 'MLB1', preco: 100 }),
      ofertaQualificavel({ item_id: 'MLB2', seller_id: 2, preco: 50, transactions_total: 0 }),
    ]);

    expect(diffOfertas(anteriores, atuais).alertas).toEqual([]);
  });

  it('não alerta saída de oferta fora da referência', () => {
    const anteriores = entradaDiffRelevante([
      anteriorQualificavel({ item_id: 'MLB1' }),
      anteriorQualificavel({ item_id: 'MLB2', seller_id: 2, transactions_total: 0 }),
    ]);
    const atuais = entradaDiffRelevante([ofertaQualificavel({ item_id: 'MLB1' })]);

    expect(diffOfertas(anteriores, atuais).alertas).toEqual([]);
  });

  it('mantém alerta para queda de preço de oferta relevante', () => {
    const anteriores = entradaDiffRelevante([anteriorQualificavel({ preco: 100 })]);
    const atuais = entradaDiffRelevante([ofertaQualificavel({ preco: 80 })]);

    expect(diffOfertas(anteriores, atuais).alertas).toContainEqual({
      tipo: 'preco_caiu', payload: { de: 100, para: 80 },
    });
  });
});
