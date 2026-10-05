// Parsers puros das respostas de Product Ads (spike 053 §3). Nunca lançam: resposta fora do contrato →
// null (a orquestração trata como erro da rodada; dado de dinheiro não é inventado nem completado).
// Os percentuais da API (acos, roas, cpc, ctr, cvr, sov, tacos) são descartados: o front recalcula por Σ.
export type TipoGrupo = 'ITEM' | 'FAMILY' | 'CATALOG';

export interface GrupoBusca {
  ad_group_id: number; tipo: TipoGrupo; external_id: string | null; campaign_id: number | null; status: string; cost: number;
}
export interface DiaAds {
  dia: string; cost: number; clicks: number; prints: number; direct_amount: number; indirect_amount: number;
  total_amount: number; direct_units: number; units: number;
}
export type ClasseResposta = 'ok' | 'sem_acesso' | 'sem_permissao' | 'nao_encontrado' | 'transitorio' | 'erro';

const TIPOS = new Set<string>(['ITEM', 'FAMILY', 'CATALOG']);
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MLB_RE = /^MLB\d+$/;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const naoNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const inteiro = (v: unknown): v is number => naoNeg(v) && Number.isInteger(v);
const idPositivo = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

export function classificarResposta(r: { status: number }): ClasseResposta {
  if (r.status >= 200 && r.status < 300) return 'ok';
  if (r.status === 401) return 'sem_acesso';
  // 403 PolicyAgent (PA_UNAUTHORIZED_RESULT_FROM_POLICIES): o mesmo corpo vem com bearer malformado e com
  // o app sem a permissão. Nunca é "token expirado": não renova, não repete.
  if (r.status === 403) return 'sem_permissao';
  if (r.status === 404) return 'nao_encontrado';
  if (r.status === 429 || r.status >= 500) return 'transitorio';
  return 'erro';
}

/** `GET /advertising/advertisers?product_id=PADS` → id do anunciante MLB; null = sem anunciante. */
export function parseAdvertiser(corpo: unknown): number | null {
  if (!obj(corpo) || !Array.isArray(corpo.advertisers)) return null;
  for (const a of corpo.advertisers) if (obj(a) && a.site_id === 'MLB') return idPositivo(a.advertiser_id);
  return null;
}

/** `…/ad_groups/search` (uma página). */
export function parseBuscaGrupos(corpo: unknown): { total: number; grupos: GrupoBusca[]; custoResumo: number | null } | null {
  if (!obj(corpo) || !obj(corpo.paging) || !Array.isArray(corpo.results)) return null;
  const total = corpo.paging.total;
  if (!inteiro(total)) return null;
  const grupos: GrupoBusca[] = [];
  for (const g of corpo.results) {
    if (!obj(g) || !obj(g.metrics)) return null;
    const id = idPositivo(g.id);
    const tipo = g.ad_group_type;
    const ext = g.ad_group_external_id;
    const campanha = g.campaign_id;
    const status = g.status;
    const cost = g.metrics.cost;
    if (id == null || typeof tipo !== 'string' || !TIPOS.has(tipo) || typeof status !== 'string' || !naoNeg(cost)) return null;
    if (ext != null && typeof ext !== 'string' && typeof ext !== 'number') return null;
    if (campanha != null && !inteiro(campanha)) return null;
    grupos.push({
      ad_group_id: id, tipo: tipo as TipoGrupo, external_id: ext == null ? null : String(ext),
      campaign_id: campanha == null ? null : campanha, status, cost,
    });
  }
  const resumo = obj(corpo.metrics_summary) ? corpo.metrics_summary.cost : null;
  return { total, grupos, custoResumo: naoNeg(resumo) ? resumo : null };
}

const DIA_MS = 86_400_000;
const diasNaJanela = (j: { desde: string; ate: string }) =>
  Math.round((Date.parse(`${j.ate}T00:00:00Z`) - Date.parse(`${j.desde}T00:00:00Z`)) / DIA_MS) + 1;

/**
 * `…/ad_groups/{id}?aggregation_type=daily`. A série é densa (zero vem explícito): resposta válida traz
 * TODOS os dias da janela. Dia faltando, fora da janela (inclusive hoje), repetido ou com campo inválido
 * → null (a rodada vira erro; nada é gravado pela metade nem completado com zero).
 */
export function parseSerieGrupo(corpo: unknown, janela: { desde: string; ate: string }): DiaAds[] | null {
  if (!obj(corpo) || !Array.isArray(corpo.results)) return null;
  const porDia = new Map<string, DiaAds>();
  for (const r of corpo.results) {
    if (!obj(r) || typeof r.date !== 'string') return null;
    const dia = r.date.slice(0, 10);
    if (!DIA_RE.test(dia) || dia < janela.desde || dia > janela.ate || porDia.has(dia)) return null;
    const cost = r.cost; const clicks = r.clicks; const prints = r.prints;
    const direto = r.direct_amount; const indireto = r.indirect_amount; const total = r.total_amount;
    const unidadesDiretas = r.direct_units_quantity; const unidades = r.units_quantity;
    if (!naoNeg(cost) || !inteiro(clicks) || !inteiro(prints) || !naoNeg(direto) || !naoNeg(indireto)
      || !naoNeg(total) || !inteiro(unidadesDiretas) || !inteiro(unidades)) return null;
    porDia.set(dia, {
      dia, cost, clicks, prints, direct_amount: direto, indirect_amount: indireto, total_amount: total,
      direct_units: unidadesDiretas, units: unidades,
    });
  }
  if (porDia.size !== diasNaJanela(janela)) return null;
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

export interface DiaConta {
  dia: string; cost: number; clicks: number; prints: number; direct_amount: number; indirect_amount: number;
  total_amount: number;
}

/** `…/campaigns/search?aggregation_type=DAILY` (total do anunciante, spike 054): densa como a do grupo. */
export function parseSerieConta(corpo: unknown, janela: { desde: string; ate: string }): DiaConta[] | null {
  if (!obj(corpo) || !Array.isArray(corpo.results)) return null;
  const porDia = new Map<string, DiaConta>();
  for (const r of corpo.results) {
    if (!obj(r) || typeof r.date !== 'string') return null;
    const dia = r.date.slice(0, 10);
    if (!DIA_RE.test(dia) || dia < janela.desde || dia > janela.ate || porDia.has(dia)) return null;
    const { cost, clicks, prints, direct_amount: direto, indirect_amount: indireto, total_amount: total } = r;
    if (!naoNeg(cost) || !inteiro(clicks) || !inteiro(prints) || !naoNeg(direto) || !naoNeg(indireto)
      || !naoNeg(total)) return null;
    porDia.set(dia, { dia, cost, clicks, prints, direct_amount: direto, indirect_amount: indireto, total_amount: total });
  }
  if (porDia.size !== diasNaJanela(janela)) return null;
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** `…/ad_groups/{id}/ads` (uma página): os MLBs membros atuais. As métricas por MLB não são lidas (R2). */
export function parseMembros(corpo: unknown): { total: number; itens: string[] } | null {
  if (!obj(corpo) || !obj(corpo.paging) || !Array.isArray(corpo.results)) return null;
  const total = corpo.paging.total;
  if (!inteiro(total)) return null;
  const itens: string[] = [];
  for (const r of corpo.results) {
    const item = obj(r) ? r.item_id : null;
    if (typeof item !== 'string' || !MLB_RE.test(item)) return null;
    itens.push(item);
  }
  return { total, itens };
}
