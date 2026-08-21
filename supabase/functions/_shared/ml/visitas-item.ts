import { redisGet, redisSet } from '../redis/client.ts';

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15_000;
const TTL_VISITAS_30D = 6 * 60 * 60;

function totalVisitas(json: unknown): number | null {
  const total = (json as { total_visits?: unknown } | null)?.total_visits;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

function totalEmCache(cache: string): number | null {
  try {
    const total = JSON.parse(cache);
    return typeof total === 'number' && Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

export async function buscarVisitas30d(token: string, itemId: string): Promise<number | null> {
  const chave = `cache:item-visits30d:v1:${itemId}`;
  const cache = await redisGet(chave).catch(() => null);
  if (cache != null) {
    const total = totalEmCache(cache);
    if (total != null) return total;
  }

  try {
    const resposta = await fetch(`${API}/items/${itemId}/visits/time_window?last=30&unit=day`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resposta.ok) return null;

    const total = totalVisitas(await resposta.json());
    if (total == null) return null;
    await redisSet(chave, JSON.stringify(total), TTL_VISITAS_30D).catch(() => undefined);
    return total;
  } catch {
    return null;
  }
}
