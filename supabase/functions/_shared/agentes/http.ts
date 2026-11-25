// Casca HTTP da edge pública `agentes` (ADR-0210, fatia 1). Pura e testável: a edge só monta `autenticar` e
// `despachar`. Ordem: método → tamanho declarado → autenticação → corpo (teto e tempo) → JSON → despacho.
// `despachar` recebe só a org e a conexão que `autenticar` devolveu. Sem CORS: clientes MCP são servidor a servidor.
import type { ResultadoAuthAgente } from './auth-agente.ts';
import { erroParse } from './mcp.ts';

export const MAX_CORPO = 65_536;
export const TEMPO_LEITURA_MS = 10_000;

export interface DepsHttp {
  autenticar(req: Request): Promise<ResultadoAuthAgente>;
  despachar(corpo: unknown, auth: { conexaoId: string; orgId: string }): Promise<{ status: number; corpo: unknown | null }>;
  /** Alarme de recusas: chamado uma vez por resposta 401, 429 ou 503, sem esperar e sem mudar a resposta. */
  aoRecusar?(): void;
}

const RECUSAS = new Set([401, 429, 503]);

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });

const CABECALHOS_RECUSA: Record<number, Record<string, string>> = {
  401: { 'WWW-Authenticate': 'Bearer' },
  429: { 'Retry-After': '60' },
};

/** Corpo como texto com teto de bytes e de tempo (a autorização não pode valer para um envio sem fim). */
async function lerCorpo(req: Request, max: number, tempoMs: number): Promise<string | 'grande' | 'tempo'> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const ler = async (): Promise<string | 'grande'> => {
    const partes: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) return 'grande';
      partes.push(value);
    }
    const tudo = new Uint8Array(total);
    let i = 0;
    for (const p of partes) { tudo.set(p, i); i += p.byteLength; }
    return new TextDecoder().decode(tudo);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tempo = new Promise<'tempo'>((r) => { timer = setTimeout(() => r('tempo'), tempoMs); });
  try {
    const r = await Promise.race([ler(), tempo]);
    if (r === 'grande' || r === 'tempo') reader.cancel().catch(() => {});
    return r;
  } finally {
    clearTimeout(timer);
  }
}

export async function tratarRequisicao(req: Request, d: DepsHttp, tempoMs = TEMPO_LEITURA_MS): Promise<Response> {
  const r = await responder(req, d, tempoMs);
  if (RECUSAS.has(r.status)) {
    try {
      d.aoRecusar?.();
    } catch {
      console.warn('[agentes] alarme de recusas indisponível');
    }
  }
  return r;
}

async function responder(req: Request, d: DepsHttp, tempoMs: number): Promise<Response> {
  if (req.method !== 'POST') return json({ erro: 'metodo_nao_permitido' }, 405, { Allow: 'POST' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CORPO) return json({ erro: 'corpo_grande' }, 413);
  try {
    const auth = await d.autenticar(req);
    if (!auth.ok) return json({ erro: auth.codigo }, auth.status, CABECALHOS_RECUSA[auth.status] ?? {});

    const texto = await lerCorpo(req, MAX_CORPO, tempoMs);
    if (texto === 'grande') return json({ erro: 'corpo_grande' }, 413);
    if (texto === 'tempo') return json({ erro: 'tempo_esgotado' }, 408);
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      const r = erroParse();
      return json(r.corpo, r.status);
    }

    const r = await d.despachar(corpo, { conexaoId: auth.conexaoId, orgId: auth.orgId });
    return r.corpo === null ? new Response(null, { status: r.status }) : json(r.corpo, r.status);
  } catch {
    // Sem a mensagem: pode carregar dado de outra camada.
    console.error('[agentes] falha inesperada');
    return json({ erro: 'indisponivel' }, 503);
  }
}
