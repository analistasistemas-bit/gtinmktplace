import { redisGet, redisSet, redisDel } from './client.ts';

const TTL_90_DIAS = 60 * 60 * 24 * 90;

export type OrigemCor = 'descricao' | 'vision' | 'manual';

export interface CacheCorEntrada {
  cor: string;
  origem: OrigemCor;
  criado_em: string;
}

function chave(userId: string, codigo: string): string {
  return `cache:cor:${userId}:${codigo}`;
}

export async function cacheCorGet(userId: string, codigo: string): Promise<CacheCorEntrada | null> {
  const valor = await redisGet(chave(userId, codigo));
  if (!valor) return null;
  try {
    return JSON.parse(valor) as CacheCorEntrada;
  } catch {
    return null;
  }
}

export async function cacheCorSet(
  userId: string,
  codigo: string,
  entrada: Omit<CacheCorEntrada, 'criado_em'>,
): Promise<void> {
  const payload: CacheCorEntrada = { ...entrada, criado_em: new Date().toISOString() };
  await redisSet(chave(userId, codigo), JSON.stringify(payload), TTL_90_DIAS);
}

export async function cacheCorInvalidar(userId: string, codigo: string): Promise<void> {
  await redisDel(chave(userId, codigo));
}
