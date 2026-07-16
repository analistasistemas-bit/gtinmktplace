import { describe, it, expect } from 'vitest';
import {
  decidirAcaoCatalogo,
  decidirResultadoRodadaCatalogo,
  decidirMotivoAlertaCatalogo,
  CATALOGO_MAX_TENTATIVAS,
  CATALOGO_BACKOFF_SEGUNDOS,
  normalizarTentativaCatalogo,
  montarBodyOptin,
  indexarEligibility,
  normalizarComprimentoMetros,
  parseProdutoCatalogoBusca,
  fichaEquivalente,
  type EligVar,
  type ResumoCatalogo,
} from '../catalogo';

const READY: EligVar = { id: 1, status: 'READY_FOR_OPTIN', buy_box_eligible: true };
const FAMILY_DIFF: EligVar = { id: 2, status: 'FAMILY_DIFF', buy_box_eligible: false, reason: 'variation_belongs_to_different_family' };
const NOT_ELIGIBLE: EligVar = { id: 3, status: 'NOT_ELIGIBLE', buy_box_eligible: false };

describe('decidirAcaoCatalogo', () => {
  it('já vinculada (catalog_listing_id) → pula, ignora elegibilidade', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: 'MLB999', catalogProductId: 'MLB1' }, READY)).toBe('pula');
  });

  it('elegível + produto casado → optin', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB24436207' }, READY)).toBe('optin');
  });

  it('elegível mas sem produto de catálogo casado → sem_produto', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: null }, READY)).toBe('sem_produto');
  });

  it('FAMILY_DIFF → family_diff (mesmo com produto casado)', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, FAMILY_DIFF)).toBe('family_diff');
  });

  it('NOT_ELIGIBLE → nao_elegivel', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, NOT_ELIGIBLE)).toBe('nao_elegivel');
  });

  it('READY mas buy_box_eligible false → nao_elegivel (não arrisca)', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, { id: 4, status: 'READY_FOR_OPTIN', buy_box_eligible: false })).toBe('nao_elegivel');
  });

  it('sem entrada de elegibilidade (item recém-criado, ainda computando) → pendente', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, undefined)).toBe('pendente');
  });

  it('entrada presente mas status ainda nulo (computando) → pendente', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, { id: 5, status: null, buy_box_eligible: null })).toBe('pendente');
  });
});

describe('decidirAcaoCatalogo — trava de equivalência (ADR-0021 pós-incidente)', () => {
  it('elegível + produto casado + ficha equivalente → optin', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, READY, { ok: true, motivo: null })).toBe('optin');
  });

  it('elegível + produto casado mas ficha NÃO equivalente (kit) → ficha_divergente', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, READY, { ok: false, motivo: 'ficha_kit_5un' })).toBe('ficha_divergente');
  });

  it('sem avaliação de equivalência (undefined) → optin (compatível com o comportamento anterior)', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, READY)).toBe('optin');
  });

  it('já vinculada tem precedência sobre equivalência', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: 'MLB9', catalogProductId: 'MLB1' }, READY, { ok: false, motivo: 'x' })).toBe('pula');
  });
});

describe('decidirResultadoRodadaCatalogo', () => {
  const base: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 };

  it('pendente>0 SEMPRE vence, mesmo com nao_elegivel misturado (bug real encontrado na revisão)', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, pendente: 2, nao_elegivel: 3 }, 1);
    expect(r.acao).toBe('aguardar_elegibilidade');
  });

  it('reagenda quando sobrou nao_elegivel, pendente=0, e ainda há tentativa', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 3 }, 1);
    expect(r).toEqual({ acao: 'reagendar', delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[0], proximaTentativa: 2 });
  });

  it.each([0, -1, 1.5, CATALOGO_MAX_TENTATIVAS + 1])(
    'normaliza tentativa inválida %s para a primeira rodada',
    (tentativa) => {
      expect(normalizarTentativaCatalogo(tentativa)).toBe(1);
      expect(decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, tentativa)).toEqual({
        acao: 'reagendar',
        delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[0],
        proximaTentativa: 2,
      });
    },
  );

  it('avança pelo backoff correto rodada a rodada', () => {
    expect(decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 2).acao === 'reagendar' &&
      (decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 2) as any).delaySegundos).toBe(CATALOGO_BACKOFF_SEGUNDOS[1]);
    expect((decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 3) as any).delaySegundos).toBe(CATALOGO_BACKOFF_SEGUNDOS[2]);
    expect((decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1 }, 4) as any).delaySegundos).toBe(CATALOGO_BACKOFF_SEGUNDOS[3]);
  });

  it('finaliza (com alerta) ao esgotar CATALOGO_MAX_TENTATIVAS', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 3 }, CATALOGO_MAX_TENTATIVAS);
    expect(r).toEqual({ acao: 'finalizar', deveAlertar: true });
  });

  it('sem_variation_id é ESTRUTURAL — finaliza direto na 1ª rodada, não reagenda', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, sem_variation_id: 2 }, 1);
    expect(r).toEqual({ acao: 'finalizar', deveAlertar: true });
  });

  it('seleciona motivo estrutural para resumo somente com sem_variation_id', () => {
    expect(decidirMotivoAlertaCatalogo({ ...base, sem_variation_id: 2 })).toBe('sem_variation_id');
  });

  it('sem nada pendente/problemático, finaliza sem alertar', () => {
    expect(decidirResultadoRodadaCatalogo({ ...base, vinculado: 5 }, 1)).toEqual({ acao: 'finalizar', deveAlertar: false });
  });
});

describe('normalizarComprimentoMetros', () => {
  it('converte metros', () => expect(normalizarComprimentoMetros('10 m')).toBe(10));
  it('converte centímetros para metros', () => expect(normalizarComprimentoMetros('10 cm')).toBeCloseTo(0.1));
  it('converte milímetros para metros', () => expect(normalizarComprimentoMetros('150 mm')).toBeCloseTo(0.15));
  it('aceita vírgula decimal', () => expect(normalizarComprimentoMetros('1,5 m')).toBeCloseTo(1.5));
  it('metragem grande de fita', () => expect(normalizarComprimentoMetros('50 m')).toBe(50));
  it('null/sem unidade → null', () => {
    expect(normalizarComprimentoMetros(null)).toBeNull();
    expect(normalizarComprimentoMetros('abc')).toBeNull();
  });
});

describe('parseProdutoCatalogoBusca', () => {
  const corpo = (attrs: Array<{ id: string; value_name: string }>) => ({
    results: [{ id: 'MLB25284234', name: 'Fita Kit 5', attributes: attrs }],
  });

  it('extrai id, sale_format, units_per_pack e comprimento em metros', () => {
    const f = parseProdutoCatalogoBusca(corpo([
      { id: 'SALE_FORMAT', value_name: 'Kit' },
      { id: 'UNITS_PER_PACK', value_name: '5' },
      { id: 'LENGTH', value_name: '10 m' },
      { id: 'WIDTH', value_name: '1.5 cm' },
    ]));
    expect(f).toEqual({ id: 'MLB25284234', saleFormat: 'Kit', unitsPerPack: 5, lengthM: 10 });
  });

  it('ficha de unidade sem UNITS_PER_PACK', () => {
    const f = parseProdutoCatalogoBusca(corpo([
      { id: 'SALE_FORMAT', value_name: 'Unidade' },
      { id: 'LENGTH', value_name: '10 m' },
    ]));
    expect(f).toEqual({ id: 'MLB25284234', saleFormat: 'Unidade', unitsPerPack: null, lengthM: 10 });
  });

  it('resultado vazio → null', () => {
    expect(parseProdutoCatalogoBusca({ results: [] })).toBeNull();
    expect(parseProdutoCatalogoBusca(null)).toBeNull();
  });
});

describe('fichaEquivalente — trava anti-kit e metragem (incidente VD MENTA)', () => {
  // O caso real do incidente: ficha "Kit 5 Unidades" casada por GTIN da unidade avulsa.
  it('REPROVA kit por UNITS_PER_PACK > 1', () => {
    const r = fichaEquivalente({ id: 'MLB25284234', saleFormat: 'Kit', unitsPerPack: 5, lengthM: 10 }, { lengthM: 10 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/kit/i);
  });

  it('REPROVA kit por SALE_FORMAT mesmo sem units (linha "10 cones")', () => {
    const r = fichaEquivalente({ id: 'MLB1', saleFormat: 'Kit', unitsPerPack: null, lengthM: null }, { lengthM: null });
    expect(r.ok).toBe(false);
  });

  it('REPROVA kit de 10 cones (UNITS_PER_PACK=10, sale_format ausente)', () => {
    const r = fichaEquivalente({ id: 'MLB1', saleFormat: null, unitsPerPack: 10, lengthM: null }, { lengthM: null });
    expect(r.ok).toBe(false);
  });

  it('REPROVA metragem divergente (Cacau 10m vs ficha 50m)', () => {
    const r = fichaEquivalente({ id: 'MLB70267621', saleFormat: 'Unidade', unitsPerPack: 1, lengthM: 50 }, { lengthM: 10 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/metragem/i);
  });

  it('APROVA unidade com metragem equivalente', () => {
    const r = fichaEquivalente({ id: 'MLB1', saleFormat: 'Unidade', unitsPerPack: 1, lengthM: 10 }, { lengthM: 10 });
    expect(r.ok).toBe(true);
  });

  it('APROVA quando a ficha tem LENGTH implausível "10 cm" (lixo de dados) e nosso é 10 m', () => {
    // 6 fichas reais traziam LENGTH="10 cm" (erro de digitação de 10 m). Não pode reprovar.
    const r = fichaEquivalente({ id: 'MLB1', saleFormat: 'Unidade', unitsPerPack: 1, lengthM: 0.1 }, { lengthM: 10 });
    expect(r.ok).toBe(true);
  });

  it('APROVA quando não há metragem para comparar e não é kit', () => {
    const r = fichaEquivalente({ id: 'MLB1', saleFormat: null, unitsPerPack: null, lengthM: null }, { lengthM: 10 });
    expect(r.ok).toBe(true);
  });
});

describe('montarBodyOptin', () => {
  it('monta o body do POST /items/catalog_listings com variation_id numérico', () => {
    expect(montarBodyOptin('MLB6901096672', '203313876609', 'MLB28853753')).toEqual({
      item_id: 'MLB6901096672',
      variation_id: 203313876609,
      catalog_product_id: 'MLB28853753',
    });
  });
});

describe('indexarEligibility', () => {
  it('indexa variações por variation_id (string)', () => {
    const m = indexarEligibility({ variations: [READY, FAMILY_DIFF] });
    expect(m.get('1')?.status).toBe('READY_FOR_OPTIN');
    expect(m.get('2')?.status).toBe('FAMILY_DIFF');
    expect(m.size).toBe(2);
  });

  it('corpo nulo/sem variations → mapa vazio', () => {
    expect(indexarEligibility(null).size).toBe(0);
    expect(indexarEligibility({}).size).toBe(0);
    expect(indexarEligibility({ status: 'READY_FOR_OPTIN' }).size).toBe(0);
  });
});
