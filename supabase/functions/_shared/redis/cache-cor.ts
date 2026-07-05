import { redisGet, redisSet, redisDel } from './client.ts';

const TTL_90_DIAS = 60 * 60 * 24 * 90;

export type OrigemCor = 'descricao' | 'vision' | 'manual';

export interface CacheCorEntrada {
  cor: string;
  origem: OrigemCor;
  criado_em: string;
}

// Chave por org (E7) — era por userId. Cache antigo por user expira sozinho (TTL 90d),
// sem migração de chaves (custo: re-inferência de cor pontual, aceito no plano E7).
function chave(orgId: string, codigo: string): string {
  return `cache:cor:${orgId}:${codigo}`;
}

export async function cacheCorGet(orgId: string, codigo: string): Promise<CacheCorEntrada | null> {
  const valor = await redisGet(chave(orgId, codigo));
  if (!valor) return null;
  try {
    return JSON.parse(valor) as CacheCorEntrada;
  } catch {
    return null;
  }
}

export async function cacheCorSet(
  orgId: string,
  codigo: string,
  entrada: Omit<CacheCorEntrada, 'criado_em'>,
): Promise<void> {
  const payload: CacheCorEntrada = { ...entrada, criado_em: new Date().toISOString() };
  await redisSet(chave(orgId, codigo), JSON.stringify(payload), TTL_90_DIAS);
}

export async function cacheCorInvalidar(orgId: string, codigo: string): Promise<void> {
  await redisDel(chave(orgId, codigo));
}
