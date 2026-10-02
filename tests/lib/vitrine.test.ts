import { describe, it, expect } from 'vitest';
import { periodoVitrine, kpisVitrine, serieVitrine, delta, ondeAgir, frasesVitrine, zProp,
  type ItemVitrine, type ResumoVitrine } from '@/lib/vitrine';

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

const cheio = { pares_ok: 28, pares_total: 28, pares_ok_ant: 28, pares_total_ant: 28 };

describe('ondeAgir', () => {
  it('Invisível: ativo, 7 dias ok com 0 visitas → topo, mesmo com emJogo menor', () => {
    const r = ondeAgir([
      item({ ml_item_id: 'SV', ...cheio, visitas: 1000, pedidos: 1, visitas_ult7: 200, dias_ok_ult7: 7 }),
      item({ ml_item_id: 'INV', ...cheio, visitas: 50, pedidos_ant: 2, visitas_ult7: 0, dias_ok_ult7: 7 }),
    ], 0.03);
    expect(r[0]).toMatchObject({ rotulo: 'invisivel', item: { ml_item_id: 'INV' } });
    expect(r[1].rotulo).toBe('sem_venda');
  });
  it('não marca Invisível com menos de 7 dias ok (anúncio novo / coleta falhou)', () => {
    expect(ondeAgir([item({ ...cheio, visitas_ult7: 0, dias_ok_ult7: 3 })], 0.03)).toEqual([]);
  });
  it('ignora pausado', () => {
    expect(ondeAgir([item({ ...cheio, status: 'paused', visitas_ult7: 0, dias_ok_ult7: 7 })], 0.03)).toEqual([]);
  });
  it('Vitrine sem venda: ≥100 visitas e conversão < 0,5× média; emJogo = visitas × (média − conv)', () => {
    const [a] = ondeAgir([item({ ...cheio, visitas: 1000, pedidos: 10, visitas_ult7: 100, dias_ok_ult7: 7 })], 0.03);
    expect(a.rotulo).toBe('sem_venda');
    expect(a.emJogo).toBeCloseTo(1000 * (0.03 - 0.01));
  });
  it('Converte e ninguém vê: ≥5 pedidos, conv ≥1,5× média, visitas < mediana', () => {
    const r = ondeAgir([
      item({ ml_item_id: 'C', ...cheio, visitas: 100, pedidos: 10, visitas_ult7: 20, dias_ok_ult7: 7 }),
      item({ ml_item_id: 'X', ...cheio, visitas: 5000, pedidos: 150, visitas_ult7: 900, dias_ok_ult7: 7 }),
      item({ ml_item_id: 'Y', ...cheio, visitas: 4000, pedidos: 120, visitas_ult7: 900, dias_ok_ult7: 7 }),
    ], 0.03);
    const c = r.find((x) => x.item.ml_item_id === 'C')!;
    expect(c.rotulo).toBe('converte');
    expect(c.emJogo).toBeCloseTo(0.5 * 100 * 0.1);
  });
  it('Perdendo visitas: ≥100 no anterior e queda > 30%; emJogo = visitas perdidas × conv anterior', () => {
    const [a] = ondeAgir([item({ ...cheio, visitas: 600, pedidos: 18, visitas_ant: 1000, pedidos_ant: 30, visitas_ult7: 100, dias_ok_ult7: 7 })], 0.03);
    expect(a.rotulo).toBe('perdendo');
    expect(a.emJogo).toBeCloseTo(400 * 0.03);
  });
  it('não marca Perdendo quando o anterior tem cobertura < 80% (anúncio criado no meio)', () => {
    expect(ondeAgir([item({ ...cheio, pares_ok_ant: 5, visitas: 600, pedidos: 18, visitas_ant: 1000, pedidos_ant: 30, visitas_ult7: 100, dias_ok_ult7: 7 })], 0.03)).toEqual([]);
  });
  it('um rótulo por anúncio: fica o de maior emJogo', () => {
    // sem_venda: 1000×(0.03−0.005)=25 ; perdendo: 2000×(10/3000)=6,7
    const [a] = ondeAgir([item({ ...cheio, visitas: 1000, pedidos: 5, visitas_ant: 3000, pedidos_ant: 10, visitas_ult7: 100, dias_ok_ult7: 7 })], 0.03);
    expect(a.rotulo).toBe('sem_venda');
  });
  it('média null (cobertura da conta < 80%) → só Invisível', () => {
    expect(ondeAgir([item({ ...cheio, visitas: 1000, pedidos: 1, visitas_ult7: 100, dias_ok_ult7: 7 })], null)).toEqual([]);
  });
});

const resumo = (o: Partial<ResumoVitrine> = {}): ResumoVitrine => ({ inicio: '2026-09-03', fim: '2026-09-30', itens: [], semanas: [], dias_semana: [], ...o });

describe('frasesVitrine', () => {
  it('tendência significativa vira frase', () => {
    const itens = [item({ visitas: 10000, pedidos: 400, pares_ok: 28, pares_total: 28, visitas_ant: 10000, pedidos_ant: 300, pares_ok_ant: 28, pares_total_ant: 28 })];
    const f = frasesVitrine(resumo({ itens }), kpisVitrine(itens), []);
    expect(f[0]).toBe('Conversão subiu de 3,0% para 4,0% contra o período anterior.');
  });
  it('diferença pequena (ruído) não vira frase', () => {
    const itens = [item({ visitas: 10000, pedidos: 310, pares_ok: 28, pares_total: 28, visitas_ant: 10000, pedidos_ant: 300, pares_ok_ant: 28, pares_total_ant: 28 })];
    expect(frasesVitrine(resumo({ itens }), kpisVitrine(itens), [])).toEqual([]);
  });
  it('dia da semana só quando TODO dow tem ≥ 12 datas medidas e cobertura ≥ 80%', () => {
    // 10 MLBs × 12 datas = 120 pares por dow; KPIs da conta sem tendência (anterior vazio) → só a frase de dow
    const dias = (semanas: number, ok = 120) => [1, 2, 3, 4, 5, 6, 7].map((dow) =>
      ({ dow, visitas: 2000, pedidos: dow === 2 ? 120 : 60, semanas, pares_ok: ok, pares_total: 120 }));
    const k = kpisVitrine([item({ visitas: 14000, pedidos: 480, pares_ok: 840, pares_total: 840 })]);
    expect(frasesVitrine(resumo({ dias_semana: dias(4) }), k, [])).toEqual([]);
    const um11 = dias(12).map((d) => (d.dow === 5 ? { ...d, semanas: 11 } : d));
    expect(frasesVitrine(resumo({ dias_semana: um11 }), k, [])).toEqual([]);
    expect(frasesVitrine(resumo({ dias_semana: dias(12, 12) }), k, [])).toEqual([]); // 1 MLB ok por data = 10%
    expect(frasesVitrine(resumo({ dias_semana: dias(12) }), k, [])).toEqual(['Terça converte mais: 6,0% contra 3,0% nos outros dias.']);
  });
  it('invisíveis: plural e singular', () => {
    const a = { item: item(), rotulo: 'invisivel' as const, emJogo: 0 };
    expect(frasesVitrine(resumo(), kpisVitrine([]), [a])).toEqual(['1 anúncio ativo está sem visita há 7 dias — veja abaixo.']);
    expect(frasesVitrine(resumo(), kpisVitrine([]), [a, a])[0]).toBe('2 anúncios ativos estão sem visita há 7 dias — veja abaixo.');
  });
  it('zProp com n = 0 não dá NaN', () => expect(zProp(0, 0, 0, 0)).toBe(0));
});
