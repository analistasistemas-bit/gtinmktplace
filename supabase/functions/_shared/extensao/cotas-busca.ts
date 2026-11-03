// Cotas da busca completa (fatia 2, Revisão 03/11 do plano — regras 2, 3, 8, 9). Tudo por LOTE para gastar
// poucos comandos Redis (Upstash cobra por comando): 1 INCRBY da quantidade + EXPIRE só quando a chave nasce
// + DECRBY do excedente só quando passa do teto. Ambas fail-closed: só protegem dado opcional.
import { redisDecrBy, redisExpire, redisIncrBy } from '../redis/client.ts';

export const LIMITE_ENRIQUECIMENTO_MIN = 10; // catálogos/min por usuário+org
export const LIMITE_ORCAMENTO_ML_MIN = 120; // chamadas ML/min do enriquecimento, app inteiro
const TTL_S = 120;

const minutoUtc = (d: Date) => d.toISOString().slice(0, 16).replace(/\D/g, ''); // yyyymmddhhmm
const proximoMinuto = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000 + 60_000).toISOString();

export const chaveEnriquecimento = (orgId: string, userId: string, agora: Date) =>
  `ext:enr:${orgId}:${userId}:${minutoUtc(agora)}`;
/** Sem dado de tenant: o teto é do app. */
export const chaveOrcamentoMl = (agora: Date) => `ext:mlapp:${minutoUtc(agora)}`;

/** Reserva até `quantidade` na janela e devolve o concedido. Lança em erro/resposta inválida do Redis. */
async function reservar(chave: string, quantidade: number, teto: number): Promise<number> {
  const n = await redisIncrBy(chave, quantidade);
  if (n === quantidade) await redisExpire(chave, TTL_S); // chave nova
  // Nunca devolve mais do que esta requisição somou (uma concorrente pode ter estourado antes).
  const excedente = Math.min(quantidade, n - teto);
  if (excedente > 0) await redisDecrBy(chave, excedente);
  return quantidade - Math.max(0, excedente);
}

async function reservarOuZero(chave: string, quantidade: number, teto: number): Promise<number> {
  try {
    return await reservar(chave, quantidade, teto);
  } catch (e) {
    console.warn('[cotas-busca] Redis falhou, fail-closed', chave.split(':').slice(0, 2).join(':'), String(e));
    return 0;
  }
}

const valido = (q: number) => Number.isInteger(q) && q > 0;

/** Debita os catálogos que vão à edge (com ou sem cache do lado do servidor); concede `min(pedido, restante)`. */
export async function reservarEnriquecimento(
  orgId: string, userId: string, quantidade: number, agora: Date,
): Promise<{ permitidos: number; retomarEm: string | null }> {
  if (!valido(quantidade)) return { permitidos: 0, retomarEm: null };
  const permitidos = await reservarOuZero(chaveEnriquecimento(orgId, userId, agora), quantidade, LIMITE_ENRIQUECIMENTO_MIN);
  return { permitidos, retomarEm: permitidos < quantidade ? proximoMinuto(agora) : null };
}

export interface ReservaOrcamentoMl { concedidas: number; chave: string; retomarEm: string | null }

const devolvidas = new WeakSet<ReservaOrcamentoMl>();

/** Reserva o limite superior de chamadas ML de uma fase do lote. Nunca despachar além de `concedidas`. */
export async function reservarOrcamentoMl(unidades: number, agora: Date): Promise<ReservaOrcamentoMl> {
  const chave = chaveOrcamentoMl(agora);
  if (!valido(unidades)) return { concedidas: 0, chave, retomarEm: null };
  const concedidas = await reservarOuZero(chave, unidades, LIMITE_ORCAMENTO_ML_MIN);
  return { concedidas, chave, retomarEm: concedidas < unidades ? proximoMinuto(agora) : null };
}

/** Fim da fase: devolve só as não despachadas, uma vez por reserva, na chave do minuto da reserva e nunca
 *  mais do que ela recebeu. Erro = débito mantido (na dúvida, conta). Retorna quantas devolveu. */
export async function devolverOrcamentoMl(reserva: ReservaOrcamentoMl, naoDespachadas: number): Promise<number> {
  const n = Math.min(Math.floor(naoDespachadas), reserva.concedidas);
  if (devolvidas.has(reserva) || !(n > 0)) return 0;
  devolvidas.add(reserva);
  try {
    await redisDecrBy(reserva.chave, n);
    return n;
  } catch (e) {
    console.warn('[cotas-busca] devolução falhou, débito mantido', String(e));
    return 0;
  }
}
