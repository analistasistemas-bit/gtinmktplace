// Partes puras da fiação do worker `coletar-ads-ml` (Fatia 2c): URLs e headers do Product Ads (spike 053 §3)
// e ids de deduplicação do QStash. Sem import Deno/npm: o vitest carrega.
import type { MsgTrafego, RespostaML } from '../trafego/sincronizar.ts';
import type { MsgAds } from './sincronizar.ts';
import type { JanelaAds } from './janelas.ts';

export const ML_API = 'https://api.mercadolibre.com';
export const METRICAS_GRUPO = 'CLICKS,PRINTS,COST,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,UNITS_QUANTITY';
/** Os status de grupo vistos no spike 053 (EMPTY, IDLE, ACTIVE, HOLD, PAUSED), como pede R4. Os 2,4 % de gasto
 *  escondidos no spike vieram de campanhas em `error` no `campaigns/search`, não de status de grupo; a T7
 *  confere que o total do `ad_groups/search` com este filtro é igual ao total sem filtro. */
export const STATUS_GRUPOS = 'ACTIVE,PAUSED,IDLE,EMPTY,HOLD';
export const LIMITE_PAGINA = 100;
export const HEADERS_ADVERTISER: Record<string, string> = { 'Api-Version': '1' };
export const HEADERS_ADS: Record<string, string> = { 'api-version': '2' };

const periodo = (j: JanelaAds) => `date_from=${j.desde}&date_to=${j.ate}`;
const BASE = '/marketplace/advertising/MLB';

export const urlAdvertiser = () => '/advertising/advertisers?product_id=PADS';
export const urlBuscaGrupos = (adv: number, j: JanelaAds, offset: number) =>
  `${BASE}/advertisers/${adv}/product_ads/ad_groups/search?limit=${LIMITE_PAGINA}&offset=${offset}&${periodo(j)}`
  + `&metrics=${METRICAS_GRUPO}&metrics_summary=true&filters[status]=${STATUS_GRUPOS}`;
export const urlSerieGrupo = (id: number, j: JanelaAds) =>
  `${BASE}/product_ads/ad_groups/${id}?${periodo(j)}&metrics=${METRICAS_GRUPO}&aggregation_type=daily`;
/** Só a lista de membros: as métricas por MLB não são usadas (R2). */
export const urlMembros = (id: number, j: JanelaAds, offset: number) =>
  `${BASE}/product_ads/ad_groups/${id}/ads?limit=${LIMITE_PAGINA}&offset=${offset}&${periodo(j)}&metrics=COST`;

/**
 * GET com 1 releitura do token em caso de 401: o token pode ter sido rotacionado no meio da cadeia (ex.:
 * renovar-tokens-ml). `renovar` só descarta o token em memória; o próximo `token()` passa de novo por
 * getValidAccessTokenConexao (única rota de refresh). 401 de novo → devolvido (a rodada vira sem_acesso).
 * 403 nunca repete: é permissão, não token.
 */
export async function getComReautenticacao(
  token: () => Promise<string>, renovar: () => void, chamar: (t: string) => Promise<RespostaML>,
): Promise<RespostaML> {
  const r = await chamar(await token());
  if (r.status !== 401) return r;
  renovar();
  return chamar(await token());
}

const seguro = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_'); // mesmo filtro de trafego/fiacao.ts
/** Prefixo próprio: o QStash deduplica por conta, e `trafego:` descartaria a mensagem de Ads. */
export const dedupFanoutAds = (orgId: string, dia: string) => seguro(`ads:${orgId}:${dia}`);
export const dedupContinuacaoAds = (m: MsgTrafego) =>
  seguro(`ads:${m.org_id}:${m.rodada ?? ''}:${m.cursor ?? ''}:${m.tentativa ?? 0}`);

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `tratarRequisicao` (2b) monta `msg: MsgTrafego` a partir do corpo HTTP sem conhecer `falhou` — campo
 * específico da orquestração de Ads (Ruling 2c-5) — mas repassa o corpo já parseado (`bruto`) como 2º
 * argumento de `sincronizar`. O worker junta a flag de volta a partir dele. Corpo ausente, inválido ou com
 * `falhou` não-booleano nunca vira `true`; e `falhou` só entra no `msg` quando `true` (nunca grava `false`
 * explícito no corpo publicado pelo QStash — `msg` intocado, mesma referência, quando ausente).
 */
export function msgAdsDoCorpo(msg: MsgTrafego, bruto: unknown): MsgAds {
  if (!obj(bruto)) return msg;
  const falhou = bruto.falhou === true;
  // `descontar`/`descontar90` (404 ou grupo sem membros com gasto): só número finito > 0; o resto é ignorado.
  const positivo = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const descontar = positivo(bruto.descontar);
  const descontar90 = positivo(bruto.descontar90);
  if (!falhou && descontar == null && descontar90 == null) return msg;
  return {
    ...msg,
    ...(falhou ? { falhou: true } : {}),
    ...(descontar != null ? { descontar } : {}),
    ...(descontar90 != null ? { descontar90 } : {}),
  };
}
