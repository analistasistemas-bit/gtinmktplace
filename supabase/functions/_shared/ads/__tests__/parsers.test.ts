import { describe, expect, it } from 'vitest';
import { classificarResposta, parseAdvertiser, parseBuscaGrupos, parseMembros, parseSerieConta, parseSerieGrupo } from '../parsers.ts';

const JANELA = { desde: '2026-09-12', ate: '2026-09-26' };
/** Os 15 dias da janela (a série do ML é densa: toda resposta válida traz todos). */
const DIAS = Array.from({ length: 15 }, (_, i) => `2026-09-${String(12 + i).padStart(2, '0')}`);
const linha = (date: string, o: Record<string, unknown> = {}) => ({
  date, clicks: 3, prints: 400, cost: 1.5, cpc: 0.5, ctr: 0.75, direct_amount: 20, indirect_amount: 0, total_amount: 20,
  direct_units_quantity: 1, units_quantity: 1, organic_units_quantity: 0, acos: 7.5, roas: 13.33, sov: 100, ...o,
});

describe('classificarResposta', () => {
  it('403 PolicyAgent é falta de permissão, nunca token expirado; 401 é acesso; 404 é recurso ausente', () => {
    expect(classificarResposta({ status: 200 })).toBe('ok');
    expect(classificarResposta({ status: 401 })).toBe('sem_acesso');
    expect(classificarResposta({ status: 403 })).toBe('sem_permissao');
    expect(classificarResposta({ status: 404 })).toBe('nao_encontrado');
    expect(classificarResposta({ status: 429 })).toBe('transitorio');
    expect(classificarResposta({ status: 503 })).toBe('transitorio');
    expect(classificarResposta({ status: 400 })).toBe('erro');
  });
});

describe('parseAdvertiser', () => {
  it('escolhe o anunciante do site MLB', () => {
    expect(parseAdvertiser({ advertisers: [
      { advertiser_id: 1000002, site_id: 'MLA', advertiser_name: '***' },
      { advertiser_id: 1000001, site_id: 'MLB', advertiser_name: '***', account_name: '***' },
    ] })).toBe(1000001);
  });
  it('lista vazia, sem MLB ou malformada → null (sem_advertiser)', () => {
    expect(parseAdvertiser({ advertisers: [] })).toBeNull();
    expect(parseAdvertiser({ advertisers: [{ advertiser_id: 1000002, site_id: 'MLA' }] })).toBeNull();
    expect(parseAdvertiser({ advertisers: [{ advertiser_id: '1000001', site_id: 'MLB' }] })).toBeNull();
    expect(parseAdvertiser(null)).toBeNull();
  });
});

describe('parseBuscaGrupos', () => {
  const corpo = {
    paging: { offset: 0, total: 3, limit: 100 },
    results: [
      { id: 3000001, ad_group_type: 'FAMILY', ad_group_external_id: '4000001', campaign_id: 2000001, status: 'ACTIVE',
        catalog_listing: false, current_advertiser_id: 1000001, metrics: { cost: 12.5, clicks: 7, roas: 3.1 } },
      { id: 3000002, ad_group_type: 'ITEM', ad_group_external_id: 'MLB1000000002', campaign_id: 0, status: 'EMPTY', metrics: { cost: 0 } },
      { id: 3000003, ad_group_type: 'CATALOG', ad_group_external_id: 4000003, campaign_id: 2000001, status: 'PAUSED', metrics: { cost: 3.25 } },
    ],
    metrics_summary: { cost: 16.0, roas: 2.2 },
  };
  it('lê grupos, total da paginação e o resumo de custo', () => {
    expect(parseBuscaGrupos(corpo)).toEqual({
      total: 3, custoResumo: 16,
      grupos: [
        { ad_group_id: 3000001, tipo: 'FAMILY', external_id: '4000001', campaign_id: 2000001, status: 'ACTIVE', cost: 12.5 },
        { ad_group_id: 3000002, tipo: 'ITEM', external_id: 'MLB1000000002', campaign_id: 0, status: 'EMPTY', cost: 0 },
        { ad_group_id: 3000003, tipo: 'CATALOG', external_id: '4000003', campaign_id: 2000001, status: 'PAUSED', cost: 3.25 },
      ],
    });
  });
  it('status fora da lista conhecida (ex.: ARCHIVED) é mantido como veio: o grupo não some da leitura', () => {
    expect(parseBuscaGrupos({ ...corpo, results: [{ ...corpo.results[0], status: 'ARCHIVED' }] })?.grupos[0].status).toBe('ARCHIVED');
  });
  it('sem metrics_summary → custoResumo null', () => {
    expect(parseBuscaGrupos({ ...corpo, metrics_summary: undefined })?.custoResumo).toBeNull();
  });
  it('tipo desconhecido, custo negativo ou sem paging → null', () => {
    expect(parseBuscaGrupos({ ...corpo, results: [{ ...corpo.results[0], ad_group_type: 'BRAND' }] })).toBeNull();
    expect(parseBuscaGrupos({ ...corpo, results: [{ ...corpo.results[0], metrics: { cost: -1 } }] })).toBeNull();
    expect(parseBuscaGrupos({ results: corpo.results })).toBeNull();
  });
});

describe('parseSerieGrupo', () => {
  const completa = (o: (d: string) => Record<string, unknown> = () => ({})) => ({ results: DIAS.map((d) => linha(d, o(d))) });
  it('lê a série densa, ordena por dia e descarta os percentuais da API (acos/roas/cpc)', () => {
    const dias = parseSerieGrupo({ results: [...DIAS].reverse().map((d) => linha(d)) }, JANELA);
    expect(dias).toHaveLength(15);
    expect(dias![0]).toEqual({ dia: '2026-09-12', cost: 1.5, clicks: 3, prints: 400, direct_amount: 20, indirect_amount: 0, total_amount: 20, direct_units: 1, units: 1 });
    expect(dias!.some((d) => 'roas' in d || 'cpc' in d || 'acos' in d)).toBe(false);
  });
  it('zero explícito do ML vira linha com cost 0', () => {
    const dias = parseSerieGrupo(completa((d) => (d === '2026-09-25'
      ? { cost: 0, clicks: 0, direct_amount: 0, total_amount: 0, direct_units_quantity: 0, units_quantity: 0 } : {})), JANELA);
    expect(dias!.find((d) => d.dia === '2026-09-25')).toMatchObject({ cost: 0, clicks: 0, total_amount: 0 });
  });
  it('dia da janela faltando → null (série furada: nunca vira zero nem é gravada pela metade)', () => {
    expect(parseSerieGrupo({ results: DIAS.slice(1).map((d) => linha(d)) }, JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: [] }, JANELA)).toBeNull();
  });
  it('dia fora da janela (inclusive hoje, parcial), repetido, negativo ou campo ausente → null', () => {
    expect(parseSerieGrupo({ results: [...DIAS.map((d) => linha(d)), linha('2026-09-27')] }, JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: [...DIAS.map((d) => linha(d)), linha('2026-09-11')] }, JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: [...DIAS.map((d) => linha(d)), linha('2026-09-26')] }, JANELA)).toBeNull();
    expect(parseSerieGrupo(completa((d) => (d === '2026-09-26' ? { cost: -0.01 } : {})), JANELA)).toBeNull();
    expect(parseSerieGrupo(completa((d) => (d === '2026-09-26' ? { units_quantity: undefined } : {})), JANELA)).toBeNull();
    expect(parseSerieGrupo(completa((d) => (d === '2026-09-26' ? { clicks: 1.5 } : {})), JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: 'x' }, JANELA)).toBeNull();
  });
});

describe('parseSerieConta', () => {
  const janela = { desde: '2026-09-01', ate: '2026-09-02' };
  const linha = (date: string, cost = 10) =>
    ({ date, cost, clicks: 1, prints: 100, direct_amount: 50, indirect_amount: 5, total_amount: 55 });
  it('série densa válida', () => {
    expect(parseSerieConta({ results: [linha('2026-09-02'), linha('2026-09-01', 0)] }, janela)).toEqual([
      { dia: '2026-09-01', cost: 0, clicks: 1, prints: 100, direct_amount: 50, indirect_amount: 5, total_amount: 55 },
      { dia: '2026-09-02', cost: 10, clicks: 1, prints: 100, direct_amount: 50, indirect_amount: 5, total_amount: 55 },
    ]);
  });
  it('dia faltando → null (nunca completa com zero)', () => {
    expect(parseSerieConta({ results: [linha('2026-09-01')] }, janela)).toBeNull();
  });
  it('dia fora da janela, repetido ou campo inválido → null', () => {
    expect(parseSerieConta({ results: [linha('2026-09-01'), linha('2026-09-03')] }, janela)).toBeNull();
    expect(parseSerieConta({ results: [linha('2026-09-01'), linha('2026-09-01')] }, janela)).toBeNull();
    expect(parseSerieConta({ results: [linha('2026-09-01'), { ...linha('2026-09-02'), cost: -1 }] }, janela)).toBeNull();
    expect(parseSerieConta({ nada: 1 }, janela)).toBeNull();
  });
});

describe('parseMembros', () => {
  it('lê os MLBs e o total', () => {
    expect(parseMembros({ paging: { total: 2, offset: 0, limit: 100 }, results: [
      { item_id: 'MLB1000000001', ad_group_id: 3000001, family_id: 4000001, user_product_id: 'MLBU1000000001', metrics: { cost: 9 } },
      { item_id: 'MLB1000000003', ad_group_id: 3000001 },
    ] })).toEqual({ total: 2, itens: ['MLB1000000001', 'MLB1000000003'] });
  });
  it('item que não é MLB ou sem paging → null', () => {
    expect(parseMembros({ paging: { total: 1 }, results: [{ item_id: 'MLBU1000000001' }] })).toBeNull();
    expect(parseMembros({ results: [] })).toBeNull();
  });
});
