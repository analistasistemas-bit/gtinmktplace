// Partes puras da fiação do worker `coletar-trafego-ml` (Task 5): ids do QStash, fetch próprio do ML,
// multiget de status, cortes de data e o roteamento HTTP. Sem import Deno/npm: o vitest carrega.
import { DAY_MS, diaDeHoje } from './janelas.ts';
import type { MsgTrafego, RespostaML, ResultadoTrafego, StatusItemGravar } from './sincronizar.ts';

/** MLB com visitas ok que o multiget não trouxe. */
export const STATUS_DESCONHECIDO = 'desconhecido';

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

/** Timeout de cada GET no ML; o orquestrador reserva 1 timeout do orçamento antes de cada tentativa. */
export const TIMEOUT_ML_MS = 10_000;

/**
 * GET no ML com timeout de 10 s. Nunca lança: status HTTP + Retry-After + corpo (JSON ou null).
 * Timeout/rede → 503 (transitório: entra no retry/adiamento em vez de virar `falha` na hora).
 */
export async function buscarML(
  url: string, token: string, f: typeof fetch = fetch, headers: Record<string, string> = {},
): Promise<RespostaML> {
  try {
    const r = await f(url, {
      method: 'GET',
      // Headers extras (api-version do Product Ads) antes: o Authorization nunca é sobrescrito.
      headers: { ...headers, Authorization: `Bearer ${token}` },
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

/** "Cor · Tamanho" dos atributos do item (UP traz COLOR/SIZE no item; Legacy com variations não). */
export function variacaoDeAtributos(attrs: unknown): string | null {
  if (!Array.isArray(attrs)) return null;
  const valor = (id: string) => {
    const v = attrs.find((a) => a?.id === id)?.value_name;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  return [valor('COLOR'), valor('SIZE')].filter(Boolean).join(' · ') || null;
}

const textoOuNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Multiget `/items/bulk?ids=…&attributes=status_code,body.id,body.status,body.title,body.permalink,body.attributes`
 * → `[{status_code|code, body}]`; só as entradas 200 com id e status. Aceita os dois envelopes.
 */
export function parseMultigetStatus(corpo: unknown): {
  ml_item_id: string; status: string; titulo: string | null; permalink: string | null; variacao: string | null;
}[] {
  if (!Array.isArray(corpo)) return [];
  const out: ReturnType<typeof parseMultigetStatus> = [];
  for (const e of corpo) {
    const b = e?.body;
    if ((e?.code ?? e?.status_code) === 200 && typeof b?.id === 'string' && typeof b?.status === 'string') {
      out.push({
        ml_item_id: b.id, status: b.status, titulo: textoOuNull(b.title), permalink: textoOuNull(b.permalink),
        variacao: variacaoDeAtributos(b.attributes),
      });
    }
  }
  return out;
}

/**
 * `gravar_trafego_item` troca o status e zera `status_desde`: um 'desconhecido' por cima de `closed`
 * reiniciaria os 30 dias para sempre. Mantém o status já gravado; só MLB sem linha fica 'desconhecido'.
 */
export const preservarStatus = (itens: StatusItemGravar[], atuais: Map<string, string>): StatusItemGravar[] =>
  itens.map((i) => (i.status === STATUS_DESCONHECIDO ? { ...i, status: atuais.get(i.ml_item_id) ?? i.status } : i));

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
  /** Nome do worker nos logs (default 'coletar-trafego-ml'). */
  rotulo?: string;
  verificar(req: Request, body: string): Promise<boolean>;
  /** Publica uma mensagem `primeira` por org com conexão ML; devolve quantas. */
  fanout(): Promise<number>;
  limpar(): Promise<void>;
  /** `bruto` = corpo JSON já parseado, sem validação: campos que esta interface não conhece (ex.: `falhou`
   *  de Ads, Ruling 2c-5) sobrevivem aqui. A 2b ignora o 2º argumento. */
  sincronizar(msg: MsgTrafego, bruto: Record<string, unknown>): Promise<{ resultado: ResultadoTrafego }>;
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
  try {
    p = body ? JSON.parse(body) : {}; // schedule manda sem body
  } catch {
    return json({ ok: false, erro: 'corpo não é JSON' }, 400);
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p) || (p.org_id != null && typeof p.org_id !== 'string')) {
    return json({ ok: false, erro: 'mensagem inválida' }, 400);
  }
  try {
    if (!p.org_id) {
      const orgs = await r.fanout();
      try {
        await r.limpar();
      } catch (e) {
        console.error(`[${r.rotulo ?? 'coletar-trafego-ml'}] limpeza da retenção falhou`, e instanceof Error ? e.message : e);
      }
      return json({ ok: true, orgs });
    }
    const msg: MsgTrafego = { org_id: p.org_id, primeira: p.primeira === true };
    if (p.rodada != null) msg.rodada = p.rodada;
    if (p.cursor !== undefined) msg.cursor = p.cursor;
    if (p.tentativa != null) msg.tentativa = p.tentativa;
    const { resultado } = await r.sincronizar(msg, p as Record<string, unknown>);
    return json({ ok: resultado !== 'erro', resultado }, resultado === 'erro' ? 500 : 200);
  } catch (e) {
    console.error(`[${r.rotulo ?? 'coletar-trafego-ml'}]`, e instanceof Error ? e.message : e);
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
}
