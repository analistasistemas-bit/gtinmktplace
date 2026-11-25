// Limites do acesso de agentes (ADR-0210, fatia 1). Conferir o teto, somar e aplicar o TTL numa única operação
// atômica (EVAL): acima do teto o contador fica intacto, e a chave nunca nasce sem TTL. Fail-closed: exceção do
// Redis, resposta inesperada ou data inválida = 'falha' (o chamador recusa com 503).
import { redisEvalInteiro } from '../redis/client.ts';

export const LIMITES = { chamadasMin: 60, falhasIpMin: 20, tarifasDia: 5000, leiturasDia: 3000 } as const;
const TTL_MIN_S = 120;
const TTL_DIA_S = 2 * 86_400;

// KEYS[1] = chave; ARGV = n, teto, ttl. -1 = acima do teto (nada escrito); senão o novo total.
const SCRIPT = `
local atual = tonumber(redis.call('GET', KEYS[1]) or '0')
local n = tonumber(ARGV[1])
if atual + n > tonumber(ARGV[2]) then return -1 end
local total = redis.call('INCRBY', KEYS[1], n)
if total == n then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3])) end
return total
`;

const minutoUtc = (d: Date) => d.toISOString().slice(0, 16).replace(/\D/g, ''); // yyyymmddhhmm
export const diaBrt = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d).replace(/\D/g, ''); // yyyymmdd

type Resultado = 'ok' | 'limite' | 'falha';

/** `chave` é calculada dentro do try: `Date` inválido (RangeError) vira 'falha'. */
async function reservar(chave: () => string, n: number, teto: number, ttl: number): Promise<Resultado> {
  try {
    const total = await redisEvalInteiro(SCRIPT, [chave()], [n, teto, ttl]);
    if (total === -1) return 'limite';
    if (total >= 1) return 'ok';
  } catch {
    // cai no fail-closed abaixo; nunca loga a mensagem crua
  }
  console.warn('[agentes] limite: redis_indisponivel');
  return 'falha';
}

export const reservarChamada = (conexaoId: string, agora: Date) =>
  reservar(() => `agt:ch:v1:${conexaoId}:${minutoUtc(agora)}`, 1, LIMITES.chamadasMin, TTL_MIN_S);

export const reservarFalhaIp = (ip: string, agora: Date) =>
  reservar(() => `agt:ip:v1:${ip}:${minutoUtc(agora)}`, 1, LIMITES.falhasIpMin, TTL_MIN_S);

/** Debita `n` de uma cota diária (fuso de São Paulo) da org. */
async function reservarDia(prefixo: string, teto: number, orgId: string, n: number, agora: Date): Promise<Resultado> {
  if (!Number.isSafeInteger(n) || n <= 0) return 'falha';
  if (n > teto) return 'limite';
  return await reservar(() => `agt:${prefixo}:v1:${orgId}:${diaBrt(agora)}`, n, teto, TTL_DIA_S);
}

/** Consultas de tarifa (comissão + frete) ao ML. */
export const reservarTarifas = (orgId: string, n: number, agora: Date) =>
  reservarDia('tar', LIMITES.tarifasDia, orgId, n, agora);

/** Leituras de item/preço no ML (multiget de até 20 MLBs cada). */
export const reservarLeituras = (orgId: string, n: number, agora: Date) =>
  reservarDia('lei', LIMITES.leiturasDia, orgId, n, agora);
