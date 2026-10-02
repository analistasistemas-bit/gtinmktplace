import { describe, it, expect } from 'vitest';
import { periodoVitrine, kpisVitrine, serieVitrine, delta, type ItemVitrine } from '@/lib/vitrine';

const item = (o: Partial<ItemVitrine> = {}): ItemVitrine => ({
  ml_item_id: 'MLB1', titulo: 't', codigo_pai: '1', status: 'active', em_ads: false,
  visitas: 0, pedidos: 0, receita: 0, pares_ok: 0, pares_total: 0,
  visitas_ant: 0, pedidos_ant: 0, receita_ant: 0, pares_ok_ant: 0, pares_total_ant: 0,
  visitas_ult7: 0, dias_ok_ult7: 0, ...o,
});

describe('periodoVitrine', () => {
  it('termina em hoje BRT − 3 (D-2 ainda é pendente) e tem 28 dias no preset 4s', () => {
    // 2026-10-02 12:00 BRT = 15:00Z
    expect(periodoVitrine('4s', Date.parse('2026-10-02T15:00:00Z'))).toEqual({ inicio: '2026-09-02', fim: '2026-09-29' });
  });
  it('usa o dia BRT, não UTC (02:00Z ainda é dia anterior em BRT)', () => {
    expect(periodoVitrine('4s', Date.parse('2026-10-02T02:00:00Z')).fim).toBe('2026-09-28');
  });
  it('12s = 84 dias, 6m = 182 dias', () => {
    const agora = Date.parse('2026-10-02T15:00:00Z');
    expect(periodoVitrine('12s', agora).inicio).toBe('2026-07-08');
    expect(periodoVitrine('6m', agora).inicio).toBe('2026-04-01');
  });
});

describe('kpisVitrine', () => {
  it('soma itens e calcula conversão e venda por visita', () => {
    const k = kpisVitrine([
      item({ visitas: 1000, pedidos: 40, receita: 2000, pares_ok: 28, pares_total: 28 }),
      item({ ml_item_id: 'MLB2', visitas: 1000, pedidos: 0, receita: 0, pares_ok: 28, pares_total: 28 }),
    ]);
    expect(k.atual.visitas).toBe(2000);
    expect(k.atual.conversao).toBeCloseTo(0.02);
    expect(k.atual.vendaPorVisita).toBeCloseTo(1);
    expect(k.atual.avisoCobertura).toBe(false);
  });
  it('cobertura entre 80% e 95% avisa mas mostra', () => {
    const k = kpisVitrine([item({ visitas: 100, pedidos: 1, pares_ok: 90, pares_total: 100 })]);
    expect(k.atual.avisoCobertura).toBe(true);
    expect(k.atual.conversao).not.toBeNull();
  });
  it('cobertura < 80% deixa visitas, conversão e venda por visita vazias (null, nunca 0)', () => {
    const k = kpisVitrine([item({ visitas: 100, pedidos: 1, pares_ok: 79, pares_total: 100 })]);
    expect(k.atual.visitas).toBeNull();
    expect(k.atual.conversao).toBeNull();
    expect(k.atual.vendaPorVisita).toBeNull();
  });
  it('sem itens (org sem coleta): tudo null/0, sem NaN', () => {
    const k = kpisVitrine([]);
    expect(k.atual.visitas).toBeNull();
    expect(k.atual.conversao).toBeNull();
    expect(k.atual.cobertura).toBe(0);
  });
  it('anterior fora da coleta (6 meses × 2 > 150 dias) → anterior null e Δ some', () => {
    const k = kpisVitrine([item({ visitas: 100, pedidos: 3, pares_ok: 28, pares_total: 28, visitas_ant: 30, pares_ok_ant: 10, pares_total_ant: 28 })]);
    expect(k.anterior.visitas).toBeNull();
    expect(delta(k.atual.visitas, k.anterior.visitas)).toBeNull();
  });
});

describe('serieVitrine', () => {
  it('semana com cobertura < 80% vira lacuna (null), não número', () => {
    expect(serieVitrine([
      { semana: '2026-09-07', visitas: 700, pedidos: 21, receita: 0, pares_ok: 7, pares_total: 7 },
      { semana: '2026-09-14', visitas: 100, pedidos: 9, receita: 0, pares_ok: 1, pares_total: 7 },
    ])).toEqual([
      { semana: '2026-09-07', visitas: 700, conv: 0.03 },
      { semana: '2026-09-14', visitas: null, conv: null },
    ]);
  });
});

describe('delta', () => {
  it('variação relativa', () => expect(delta(110, 100)).toBeCloseTo(0.1));
  it('anterior null ou 0 → null (sem +∞%)', () => {
    expect(delta(10, null)).toBeNull();
    expect(delta(10, 0)).toBeNull();
  });
});
