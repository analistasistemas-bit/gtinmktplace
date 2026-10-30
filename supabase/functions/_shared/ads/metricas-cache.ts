// Cache segregado e refresh limitado das métricas de Ads (plano ads-redesign §5.5). Arquivo próprio para não
// misturar Redis com a leitura pura de metricas-leitura.ts. Deps injetáveis; `depsRedisAds` liga o client existente.
import { redisGet, redisSet, redisSetNX } from '../redis/client.ts';

export const VERSAO_CONTRATO_ADS = 'v1';
export const TTL_CACHE_ADS_S = 300;
export const TTL_FRESCO_ADS_S = 60;

export interface DepsCacheAds {
  get(chave: string): Promise<string | null>;
  set(chave: string, valor: string, ttlSegundos: number): Promise<void>;
  setNX(chave: string, valor: string, ttlSegundos: number): Promise<boolean>;
}

export const depsRedisAds: DepsCacheAds = { get: redisGet, set: redisSet, setNX: redisSetNX };

interface Janela { desde: string; ate: string }

export interface ChaveMetricasAds {
  orgId: string;
  conexaoId: string;
  advertiserId: number;
  escopo: 'conta' | 'campanha';
  campanhaId: number | null;
  atual: Janela;
  anterior: Janela | null;
}

/** Cada componente é codificado (`:` não vaza para o vizinho); org, conexão, anunciante, escopo, campanha, datas e comparação entram todos. */
export function chaveMetricasAds(c: ChaveMetricasAds): string {
  const e = (v: string | number | null) => encodeURIComponent(String(v));
  const comp = c.anterior ? `${e(c.anterior.desde)}:${e(c.anterior.ate)}` : 'sem';
  return [
    'ads:metricas', VERSAO_CONTRATO_ADS, e(c.orgId), e(c.conexaoId), e(c.advertiserId), e(c.escopo), e(c.campanhaId),
    e(c.atual.desde), e(c.atual.ate), comp,
  ].join(':');
}

export type ResultadoCacheAds<T> =
  | { estado: 'ok'; valor: T; origem: 'cache' | 'ml' }
  | { estado: 'recusado'; motivo: string };

/**
 * Lê do cache (300 s) ou do ML via `ler`. Falha de leitura do cache segue para o ML; falha de escrita não derruba a
 * resposta. Só grava quando `completo` (nunca listagem truncada); a gravação substitui a chave, não acumula.
 * `fresco` ignora o cache e é limitado a 1 por organização a cada 60 s por `setNX`; se o Redis falhar não dá para
 * impor o limite, então é recusado (falha de cache não autoriza chamadas ilimitadas) — nenhuma chamada ao ML.
 */
export async function lerMetricasComCache<T>(
  deps: DepsCacheAds, chave: string, orgId: string, fresco: boolean,
  ler: () => Promise<{ valor: T; completo: boolean }>,
): Promise<ResultadoCacheAds<T>> {
  if (fresco) {
    let livre: boolean;
    try { livre = await deps.setNX(`ads:metricas:fresco:${encodeURIComponent(orgId)}`, '1', TTL_FRESCO_ADS_S); } catch {
      return { estado: 'recusado', motivo: 'Não foi possível confirmar o limite de atualização agora. Tente novamente em instantes.' };
    }
    if (!livre) return { estado: 'recusado', motivo: 'Atualização recente. Tente novamente em alguns segundos.' };
  } else {
    try {
      const hit = await deps.get(chave);
      if (hit) return { estado: 'ok', valor: JSON.parse(hit) as T, origem: 'cache' };
    } catch (e) { console.warn('[ads-metricas] cache indisponível (leitura)', e); }
  }
  const r = await ler();
  if (r.completo) {
    try { await deps.set(chave, JSON.stringify(r.valor), TTL_CACHE_ADS_S); } catch (e) {
      console.warn('[ads-metricas] cache indisponível (escrita)', e);
    }
  }
  return { estado: 'ok', valor: r.valor, origem: 'ml' };
}
