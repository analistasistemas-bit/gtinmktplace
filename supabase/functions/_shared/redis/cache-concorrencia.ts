import { redisGet, redisSet } from './client.ts';
import type { ClasseConcorrencia, OrigemConcorrencia, DadosOfertas } from '../concorrencia/tipos.ts';

const TTL_6_HORAS = 60 * 60 * 6;

export interface CacheConcorrenciaEntrada {
  vendedores: number;
  preco_min: number | null;
  origem: OrigemConcorrencia;
  classe: ClasseConcorrencia;
  product_id?: string | null;
  ofertas?: DadosOfertas;
  criado_em: string;
}

// cache global: a concorrência de um GTIN/título no ML é igual para qualquer usuário
function chave(termo: string): string {
  return `cache:concorrencia:${termo}`;
}

export async function cacheConcorrenciaGet(termo: string): Promise<CacheConcorrenciaEntrada | null> {
  const valor = await redisGet(chave(termo));
  if (!valor) return null;
  try {
    return JSON.parse(valor) as CacheConcorrenciaEntrada;
  } catch {
    return null;
  }
}

export async function cacheConcorrenciaSet(
  termo: string,
  entrada: Omit<CacheConcorrenciaEntrada, 'criado_em'>,
): Promise<void> {
  const payload: CacheConcorrenciaEntrada = { ...entrada, criado_em: new Date().toISOString() };
  await redisSet(chave(termo), JSON.stringify(payload), TTL_6_HORAS);
}
