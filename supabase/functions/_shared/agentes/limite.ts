// Limites do acesso de agentes (ADR-0210, fatia 1). Mesmo desenho de `_shared/extensao/cotas-busca.ts`: 1 INCRBY
// (+ EXPIRE quando a chave nasce). Janelas por minuto: sem DECRBY acima do teto (fecham até o minuto virar).
// Teto diário de tarifas: devolve o `n` recusado (senão um pedido grande travaria a org até o fim do dia).
// Fail-closed: exceção do Redis ou data inválida = 'falha' (o chamador recusa com 503).
import { redisDecrBy, redisExpire, redisIncrBy } from '../redis/client.ts';

export const LIMITES = { chamadasMin: 60, falhasIpMin: 20, tarifasDia: 5000 } as const;
const TTL_MIN_S = 120;
const TTL_DIA_S = 2 * 86_400;

const minutoUtc = (d: Date) => d.toISOString().slice(0, 16).replace(/\D/g, ''); // yyyymmddhhmm
const diaBrt = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d).replace(/\D/g, ''); // yyyymmdd

type Resultado = 'ok' | 'limite' | 'falha';

/** `chave` é calculada dentro do try: `Date` inválido (RangeError) vira 'falha'. */
async function reservar(
  chave: () => string, n: number, teto: number, ttl: number, devolve: boolean, rotulo: string,
): Promise<Resultado> {
  try {
    const k = chave();
    const total = await redisIncrBy(k, n);
    if (total === n) await redisExpire(k, ttl); // chave nova
    if (total <= teto) return 'ok';
    if (devolve) await redisDecrBy(k, n);
    return 'limite';
  } catch (e) {
    console.warn('[agentes/limite] Redis falhou, fail-closed', rotulo, String(e));
    return 'falha';
  }
}

export const reservarChamada = (conexaoId: string, agora: Date) =>
  reservar(() => `agt:ch:v1:${conexaoId}:${minutoUtc(agora)}`, 1, LIMITES.chamadasMin, TTL_MIN_S, false, 'agt:ch');

export const reservarFalhaIp = (ip: string, agora: Date) =>
  reservar(() => `agt:ip:v1:${ip}:${minutoUtc(agora)}`, 1, LIMITES.falhasIpMin, TTL_MIN_S, false, 'agt:ip');

/** Debita `n` tarifas de uma vez no dia (fuso de São Paulo) da org. Recusa devolve o `n` (contador = uso real). */
export async function reservarTarifas(orgId: string, n: number, agora: Date): Promise<Resultado> {
  if (!Number.isSafeInteger(n) || n <= 0) return 'falha';
  if (n > LIMITES.tarifasDia) return 'limite';
  return await reservar(() => `agt:tar:v1:${orgId}:${diaBrt(agora)}`, n, LIMITES.tarifasDia, TTL_DIA_S, true, 'agt:tar');
}
