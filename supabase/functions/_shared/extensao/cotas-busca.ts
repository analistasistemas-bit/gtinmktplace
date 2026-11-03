// Cotas do enriquecimento da busca (fatia 2, Revisão 03/11-b: lote por página). Poucos comandos Redis (Upstash
// cobra por comando): cota de página = 1 INCRBY (+ EXPIRE quando a chave nasce); orçamento global = 1 INCRBY do
// limite superior da página (+ EXPIRE ao nascer, + DECRBY do excedente só quando passa do teto). Ambas fail-closed:
// só protegem dado opcional.
import { redisDecrBy, redisExpire, redisIncrBy } from '../redis/client.ts';

export const LIMITE_PAGINAS_MIN = 20; // pedidos de enriquecimento não vazios/min por usuário+org
export const LIMITE_ORCAMENTO_ML_MIN = 1000; // chamadas ML/min do enriquecimento, app inteiro (spike §6)
const TTL_S = 120;

const minutoUtc = (d: Date) => d.toISOString().slice(0, 16).replace(/\D/g, ''); // yyyymmddhhmm

export const chavePagina = (orgId: string, userId: string, agora: Date) =>
  `ext:enr:pagina:v1:${orgId}:${userId}:${minutoUtc(agora)}`;
/** Sem dado de tenant: o teto é do app. */
export const chaveOrcamentoMl = (agora: Date) => `ext:mlapp:${minutoUtc(agora)}`;

/** Contador opcional de comandos Redis emitidos (Task 11 mede o custo por página); conta tentativas. */
export interface ContadorRedis { comandosRedis: number }

/** Debita uma página (rodada de até 50 catálogos). Acima do teto o contador só cresce (sem DECRBY: a janela já
 *  está fechada até o minuto virar). Erro/resposta inválida do Redis = 'falha' (recusada, fail-closed). */
export async function reservarPagina(orgId: string, userId: string, agora: Date, c?: ContadorRedis): Promise<'ok' | 'limite' | 'falha'> {
  const chave = chavePagina(orgId, userId, agora);
  try {
    if (c) c.comandosRedis++;
    const n = await redisIncrBy(chave, 1);
    if (n === 1) { if (c) c.comandosRedis++; await redisExpire(chave, TTL_S); }
    return n <= LIMITE_PAGINAS_MIN ? 'ok' : 'limite';
  } catch (e) {
    console.warn('[cotas-busca] Redis falhou, fail-closed', 'ext:enr', String(e));
    return 'falha';
  }
}

/** Reserva até `quantidade` na janela e devolve o concedido. Lança em erro/resposta inválida do Redis. */
async function reservar(chave: string, quantidade: number, teto: number, c?: ContadorRedis): Promise<number> {
  if (c) c.comandosRedis++;
  const n = await redisIncrBy(chave, quantidade);
  if (n === quantidade) { if (c) c.comandosRedis++; await redisExpire(chave, TTL_S); } // chave nova
  // Nunca devolve mais do que esta requisição somou (uma concorrente pode ter estourado antes).
  const excedente = Math.min(quantidade, n - teto);
  if (excedente > 0) { if (c) c.comandosRedis++; await redisDecrBy(chave, excedente); }
  return quantidade - Math.max(0, excedente);
}

const valido = (q: number) => Number.isInteger(q) && q > 0;

export interface ReservaOrcamentoMl { concedidas: number; chave: string }

/** Reservas ainda devolvíveis → instante (ms) a partir do qual a chave pode já ter expirado: início do minuto
 *  + TTL. A chave nasce com EXPIRE 120 s em algum ponto desse minuto, então antes disso ela está viva. */
const devolviveis = new WeakMap<ReservaOrcamentoMl, number>();

/** Reserva o limite superior de chamadas ML da página. Nunca despachar além de `concedidas`. Erro = 0. */
export async function reservarOrcamentoMl(unidades: number, agora: Date, c?: ContadorRedis): Promise<ReservaOrcamentoMl> {
  const chave = chaveOrcamentoMl(agora);
  if (!valido(unidades)) return { concedidas: 0, chave };
  let concedidas = 0;
  try {
    concedidas = await reservar(chave, unidades, LIMITE_ORCAMENTO_ML_MIN, c);
  } catch (e) {
    console.warn('[cotas-busca] Redis falhou, fail-closed', 'ext:mlapp', String(e));
  }
  const reserva = { concedidas, chave };
  if (concedidas > 0) devolviveis.set(reserva, Math.floor(agora.getTime() / 60_000) * 60_000 + TTL_S * 1000);
  return reserva;
}

/** Devolve só as não despachadas, uma vez por reserva, na chave do minuto da reserva e nunca mais do que ela
 *  recebeu. Chave possivelmente expirada = no-op (DECRBY recriaria um contador negativo sem TTL). Erro = débito
 *  mantido (na dúvida, conta). Retorna quantas devolveu. */
export async function devolverOrcamentoMl(
  reserva: ReservaOrcamentoMl, naoDespachadas: number, agora: Date, c?: ContadorRedis,
): Promise<number> {
  const vivaAte = devolviveis.get(reserva);
  const n = Math.min(Math.floor(naoDespachadas), reserva.concedidas);
  if (vivaAte === undefined || agora.getTime() >= vivaAte || !(n > 0)) return 0;
  devolviveis.delete(reserva);
  try {
    if (c) c.comandosRedis++;
    await redisDecrBy(reserva.chave, n);
    return n;
  } catch (e) {
    console.warn('[cotas-busca] devolução falhou, débito mantido', String(e));
    return 0;
  }
}
