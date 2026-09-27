// Partes puras da fiação do worker `coletar-trafego-ml` (Task 5): ids do QStash, fetch próprio do ML,
// multiget de status, cortes de data e o roteamento HTTP. Sem import Deno/npm: o vitest carrega.
import { DAY_MS, diaDeHoje } from './janelas.ts';
import type { MsgTrafego, RespostaML, ResultadoTrafego } from './sincronizar.ts';

const seguro = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_'); // mesmo filtro de promocoes/deps.ts

/** Fan-out: uma mensagem por org por dia (BRT); o QStash descarta a repetição. */
export const dedupFanout = (orgId: string, dia: string) => seguro(`trafego:${orgId}:${dia}`);

/** Continuação: org+rodada+cursor+tentativa — republicar no mesmo cursor (429) muda a tentativa. */
export const dedupContinuacao = (m: MsgTrafego) =>
  seguro(`trafego:${m.org_id}:${m.rodada ?? ''}:${m.cursor ?? ''}:${m.tentativa ?? 0}`);

/** `delay` do QStash é em segundos (queue.ts). */
export const delaySegundos = (ms?: number) => (ms && ms > 0 ? Math.ceil(ms / 1000) : undefined);

// ponytail: só Retry-After em segundos (o que o ML manda); data HTTP vira null → fallback de 1,5 s.
export function parseRetryAfterMs(h: string | null): number | null {
  const n = h == null || h.trim() === '' ? NaN : Number(h);
  return Number.isFinite(n) && n >= 0 ? n * 1000 : null;
}

export const TIMEOUT_ML_MS = 15_000;

/**
 * GET no ML com timeout de 15 s. Nunca lança: status HTTP + Retry-After + corpo (JSON ou null).
 * Timeout/rede → 503 (transitório: entra no retry/adiamento em vez de virar `falha` na hora).
 */
export async function buscarML(url: string, token: string, f: typeof fetch = fetch): Promise<RespostaML> {
  try {
    const r = await f(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_ML_MS),
    });
    const texto = await r.text();
    let corpo: unknown = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { /* corpo não-JSON */ }
    return { status: r.status, retryAfterMs: parseRetryAfterMs(r.headers.get('retry-after')), corpo };
  } catch {
    return { status: 503, retryAfterMs: null, corpo: null };
  }
}

/** `/items?ids=…&attributes=id,status` → `[{code, body:{id,status}}]`; só as entradas 200 completas. */
export function parseMultigetStatus(corpo: unknown): { ml_item_id: string; status: string }[] {
  if (!Array.isArray(corpo)) return [];
  const out: { ml_item_id: string; status: string }[] = [];
  for (const e of corpo) {
    const b = e?.body;
    if (e?.code === 200 && typeof b?.id === 'string' && typeof b?.status === 'string') {
      out.push({ ml_item_id: b.id, status: b.status });
    }
  }
  return out;
}

export interface LinhaTrafegoItem { ml_item_id: string; status: string; status_desde: string; ultimo_ok_em: string | null }

/** Encerrado = `closed` há mais de 30 dias (desde que o vimos assim); comColetaOk = já teve visitas ok. */
export function classificarItensTrafego(linhas: LinhaTrafegoItem[], agoraMs: number) {
  const encerradosHaMaisDe30d = new Set<string>();
  const comColetaOk = new Set<string>();
  for (const l of linhas) {
    if (l.status === 'closed' && Date.parse(l.status_desde) < agoraMs - 30 * DAY_MS) encerradosHaMaisDe30d.add(l.ml_item_id);
    if (l.ultimo_ok_em) comColetaOk.add(l.ml_item_id);
  }
  return { encerradosHaMaisDe30d, comColetaOk };
}

/** Retenção de 13 meses: apaga `dia` < (hoje BRT − 13 meses). */
export function corteRetencao(agora: Date): string {
  const [a, m, d] = diaDeHoje(agora, 'brt').split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 - 13, d)).toISOString().slice(0, 10);
}

/** Vendidos entram no inventário se `ml_vendas.date_closed` está nos últimos 180 dias. */
export const corteVendidos = (agoraMs: number) => new Date(agoraMs - 180 * DAY_MS).toISOString();

export interface Rotas {
  verificar(req: Request, body: string): Promise<boolean>;
  /** Publica uma mensagem `primeira` por org com conexão ML; devolve quantas. */
  fanout(): Promise<number>;
  limpar(): Promise<void>;
  sincronizar(msg: MsgTrafego): Promise<{ resultado: ResultadoTrafego }>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Worker QStash puro: assinatura obrigatória (401). Sem org_id → fan-out e só depois a retenção
 * (falha da limpeza só loga). Com org_id → uma mensagem da cadeia; `erro` → 500 (ADR-0171), o resto 200.
 */
export async function tratarRequisicao(req: Request, r: Rotas): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await req.text();
  if (!(await r.verificar(req, body))) return new Response('Invalid signature', { status: 401 });
  let p: Partial<MsgTrafego> = {};
  try { p = body ? JSON.parse(body) : {}; } catch { /* body vazio do schedule */ }
  try {
    if (!p.org_id) {
      const orgs = await r.fanout();
      try {
        await r.limpar();
      } catch (e) {
        console.error('[coletar-trafego-ml] limpeza da retenção falhou', e instanceof Error ? e.message : e);
      }
      return json({ ok: true, orgs });
    }
    const msg: MsgTrafego = { org_id: p.org_id, primeira: p.primeira === true };
    if (p.rodada != null) msg.rodada = p.rodada;
    if (p.cursor !== undefined) msg.cursor = p.cursor;
    if (p.tentativa != null) msg.tentativa = p.tentativa;
    const { resultado } = await r.sincronizar(msg);
    return json({ ok: resultado !== 'erro', resultado }, resultado === 'erro' ? 500 : 200);
  } catch (e) {
    console.error('[coletar-trafego-ml]', e instanceof Error ? e.message : e);
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
}
