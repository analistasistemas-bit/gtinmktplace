import { describe, it, expect } from 'vitest';
import { montarCampanhas, ROTULO_MOTIVO, ROTULO_ALERTA } from '@/lib/ads-campanhas';
import type { AnuncioPatrocinado, CampanhaAds, ItemAgora, RespostaCampanhasOk } from '@/lib/ads-campanhas';

const camp = (id: number, over: Partial<CampanhaAds> = {}): CampanhaAds => ({
  id, nome: `C${id}`, status: 'active', estrategia: null, roasObjetivo: null, acosObjetivo: null, orcamentoDiario: null, ...over,
});
const ITEM_OK: ItemAgora = { status: 'active', subStatus: [], estoque: 5, preco: 10 };
const anu = (mlb: string, campanhaId: number, over: Partial<AnuncioPatrocinado> = {}): AnuncioPatrocinado => ({
  mlb, campanhaId, grupoId: null, statusAds: 'active', catalogo: false, titulo: null, thumbnail: null, permalink: null,
  item: ITEM_OK, equilibrio: { acosPct: 20, motivo: null }, ...over,
});
const resp = (campanhas: CampanhaAds[], anuncios: AnuncioPatrocinado[], publicadosPorFamilia: Record<string, string[]> | null = null): RespostaCampanhasOk => ({
  ok: true, estado: 'ok', lidoEm: '2026-10-20T10:00:00Z', aliquotasConfirmadas: true, projecaoLimitada: false,
  publicadosPorFamilia, campanhas, anuncios,
});
// MLB1,MLB2 → família P1; MLB3 → P2; MLB9 → sem código
const codigosPorMlb = new Map([['MLB1', ['A1']], ['MLB2', ['A2']], ['MLB3', ['B1']], ['MLB4', ['A1', 'B1']], ['MLB5', ['A1', 'X']]]);
const familiaDoCodigo = new Map([['A1', 'P1'], ['A2', 'P1'], ['B1', 'P2']]);
const nomeDaFamilia = new Map([['P1', 'Zeta'], ['P2', 'Alfa']]);
const montar = (r: RespostaCampanhasOk) => montarCampanhas({ resposta: r, codigosPorMlb, familiaDoCodigo, nomeDaFamilia });

describe('montarCampanhas', () => {
  it('agrupa MLBs por família, mantendo a ordem da resposta', () => {
    const [c] = montar(resp([camp(1)], [anu('MLB2', 1), anu('MLB1', 1)]));
    expect(c.familias).toHaveLength(1);
    expect(c.familias[0].codigoPai).toBe('P1');
    expect(c.familias[0].nome).toBe('Zeta');
    expect(c.familias[0].anuncios.map((a) => a.mlb)).toEqual(['MLB2', 'MLB1']);
    expect(c.foraDoPubliai).toEqual([]);
  });

  it('fora do PubliAI: sem códigos, código sem família, 2 famílias', () => {
    const [c] = montar(resp([camp(1)], [anu('MLB9', 1), anu('MLB5', 1), anu('MLB4', 1)]));
    expect(c.familias).toEqual([]);
    expect(c.foraDoPubliai.map((a) => a.mlb)).toEqual(['MLB9', 'MLB5', 'MLB4']);
  });

  it('equilíbrio = mínimo dos MLBs; null propaga com o motivo', () => {
    const [c] = montar(resp([camp(1)], [anu('MLB1', 1, { equilibrio: { acosPct: 30, motivo: null } }), anu('MLB2', 1, { equilibrio: { acosPct: 12, motivo: null } })]));
    expect(c.familias[0].equilibrioPct).toBe(12);
    const [d] = montar(resp([camp(1)], [anu('MLB1', 1), anu('MLB2', 1, { equilibrio: { acosPct: null, motivo: 'sem_custo' } })]));
    expect(d.familias[0].equilibrioPct).toBeNull();
    expect(d.familias[0].motivoEquilibrio).toBe('sem_custo');
  });

  describe('roas_acima_margem', () => {
    it('alerta quando acosObjetivo > equilíbrio', () => {
      const [c] = montar(resp([camp(1, { acosObjetivo: 25 })], [anu('MLB1', 1)]));
      expect(c.familias[0].alertas).toEqual(['roas_acima_margem']);
      expect(c.totalAlertas).toBe(1);
    });
    it('não alerta: igual, sem objetivo, sem equilíbrio, campanha pausada', () => {
      expect(montar(resp([camp(1, { acosObjetivo: 20 })], [anu('MLB1', 1)]))[0].familias[0].alertas).toEqual([]);
      expect(montar(resp([camp(1)], [anu('MLB1', 1)]))[0].familias[0].alertas).toEqual([]);
      expect(montar(resp([camp(1, { acosObjetivo: 25 })], [anu('MLB1', 1, { equilibrio: { acosPct: null, motivo: 'sem_custo' } })]))[0].familias[0].alertas).toEqual([]);
      expect(montar(resp([camp(1, { acosObjetivo: 25, status: 'paused' })], [anu('MLB1', 1)]))[0].familias[0].alertas).toEqual([]);
    });
  });

  describe('patrocinado_parado', () => {
    const alertas = (item: ItemAgora | null, statusAds = 'active', st: 'active' | 'paused' = 'active') =>
      montar(resp([camp(1, { status: st })], [anu('MLB1', 1, { item, statusAds })]))[0].familias[0].alertas;
    it('item pausado ou estoque 0 alerta', () => {
      expect(alertas({ ...ITEM_OK, status: 'paused' })).toEqual(['patrocinado_parado']);
      expect(alertas({ ...ITEM_OK, estoque: 0 })).toEqual(['patrocinado_parado']);
    });
    it('não alerta: item null, hold com item ativo, campanha pausada', () => {
      expect(alertas(null)).toEqual([]);
      expect(alertas(ITEM_OK, 'hold')).toEqual([]);
      expect(alertas({ ...ITEM_OK, estoque: 0 }, 'active', 'paused')).toEqual([]);
    });
  });

  describe('parcialmente_patrocinada', () => {
    it('alerta e conta publicados/patrocinados', () => {
      const [c] = montar(resp([camp(1)], [anu('MLB1', 1)], { P1: ['MLB1', 'MLB2', 'MLB7'] }));
      expect(c.familias[0].alertas).toEqual(['parcialmente_patrocinada']);
      expect(c.familias[0].publicados).toBe(3);
      expect(c.familias[0].patrocinados).toBe(1);
    });
    it('família dividida em duas campanhas ativas não alerta', () => {
      const r = montar(resp([camp(1), camp(2)], [anu('MLB1', 1), anu('MLB2', 2)], { P1: ['MLB1', 'MLB2'] }));
      expect(r[0].familias[0].alertas).toEqual([]);
      expect(r[1].familias[0].alertas).toEqual([]);
      expect(r[0].familias[0].patrocinados).toBe(2);
    });
    it('publicadosPorFamilia null → sem alerta, publicados 0', () => {
      const [c] = montar(resp([camp(1)], [anu('MLB1', 1)], null));
      expect(c.familias[0].alertas).toEqual([]);
      expect(c.familias[0].publicados).toBe(0);
    });
    it('campanha pausada não alerta', () => {
      const [c] = montar(resp([camp(1, { status: 'paused' })], [anu('MLB1', 1)], { P1: ['MLB1', 'MLB2'] }));
      expect(c.familias[0].alertas).toEqual([]);
    });
  });

  it('ordenação: campanhas como recebidas; famílias com alerta primeiro, depois nome (null por último), depois código', () => {
    const cods = new Map([...codigosPorMlb, ['MLB6', ['C1']]]);
    const fam = new Map([...familiaDoCodigo, ['C1', 'P3']]);
    const [c] = montarCampanhas({
      resposta: resp([camp(2), camp(1)], [anu('MLB3', 2), anu('MLB1', 2, { item: { ...ITEM_OK, estoque: 0 } }), anu('MLB6', 2)]),
      codigosPorMlb: cods, familiaDoCodigo: fam, nomeDaFamilia,
    });
    expect(c.id).toBe(2);
    expect(c.familias.map((f) => f.codigoPai)).toEqual(['P1', 'P2', 'P3']); // P1 alerta; P2 Alfa; P3 sem nome
  });

  it('rótulos cobrem todos os motivos e alertas', () => {
    for (const m of ['sem_cadastro', 'sem_custo', 'sem_origem', 'sem_dimensao', 'sem_preco', 'sem_categoria', 'erro_tarifa', 'erro_item',
      'sem_aliquota', 'fora_da_projecao', 'kit_divergente', 'kit_ambiguo', 'kit_sem_dimensao']) expect(ROTULO_MOTIVO[m]).toBeTruthy();
    expect(Object.keys(ROTULO_ALERTA).sort()).toEqual(['parcialmente_patrocinada', 'patrocinado_parado', 'roas_acima_margem']);
  });
});
