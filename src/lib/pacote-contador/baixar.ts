// ADR-0181 Plano 2a — download binário do zip do mês. NUNCA via functions.invoke(): functions-js 2.106.2
// lê application/zip como texto e corrompe os bytes.
import { supabase } from '@/lib/supabase';
import { ErroDownloadIncompleto } from './tipos';

export type ResultadoDownload = { tipo: 'zip'; bytes: Uint8Array; contaMl: string } | { tipo: 'vazio'; contaMl: string };
export class ErroPacote extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ErroPacote'; }
}
export class ErroOrgMudou extends Error {
  constructor() { super('A organização mudou durante o download — gere o pacote de novo.'); this.name = 'ErroOrgMudou'; }
}
export class ErroAuditoria extends Error {
  constructor(m: string) { super(m); this.name = 'ErroAuditoria'; }
}
/** Só a falha do fetch antes dos headers — TypeError de código continua sendo bug (fatal). */
export class ErroRede extends Error {
  constructor() { super('falha de rede ao falar com o servidor'); this.name = 'ErroRede'; }
}
const ehAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

async function lerJson(r: Response): Promise<{ error?: string; vazio?: boolean; codigo?: string } | null> {
  try { return await r.json(); } catch (e) { if (ehAbort(e)) throw e; return null; }
}

export async function baixarNotasMes(mes: string, orgEsperada: string, signal?: AbortSignal): Promise<ResultadoDownload> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new ErroPacote('Sessão expirada — entre de novo.', 401);
  let r: Response;
  try {
    r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/baixar-notas-venda`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ mes }),
    });
  } catch (e) {
    if (ehAbort(e)) throw e;
    throw new ErroRede();
  }
  const tipo = r.headers.get('Content-Type') ?? '';
  if (!r.ok || !r.headers.get('X-Org-Id')) {
    const j = tipo.includes('json') ? await lerJson(r) : null;
    if (j?.codigo === 'auditoria') throw new ErroAuditoria(j.error ?? 'Falha ao registrar a auditoria do suporte.');
    throw new ErroPacote(j?.error ?? 'Não foi possível confirmar as notas do mês.', r.status);
  }
  if (r.headers.get('X-Org-Id') !== orgEsperada) {
    throw new ErroOrgMudou();
  }
  const contaMl = r.headers.get('X-Conta-Ml') ?? '';
  if (tipo.includes('json')) {
    const j = await lerJson(r);
    if (j?.vazio === true) return { tipo: 'vazio', contaMl };
    throw new ErroPacote('Não foi possível confirmar as notas do mês.', 502);
  }
  try {
    return { tipo: 'zip', bytes: new Uint8Array(await r.arrayBuffer()), contaMl };
  } catch (e) {
    if (ehAbort(e)) throw e;
    throw new ErroDownloadIncompleto();   // stream cortado depois do 200
  }
}

const INDISPONIVEL = new Set([429, 409, 502, 503, 504, 200]);
/** Falha da parte de vendas: vira "indisponível" (pacote sai com compras) ou aborta tudo. Em suporte, sempre aborta. */
export function falhaVendas(e: unknown, emSuporte: boolean): { tipo: 'indisponivel'; motivo: string } | { tipo: 'fatal' } {
  if (emSuporte || ehAbort(e) || e instanceof ErroOrgMudou || e instanceof ErroAuditoria) return { tipo: 'fatal' };
  if (e instanceof ErroPacote) return INDISPONIVEL.has(e.status) ? { tipo: 'indisponivel', motivo: e.message } : { tipo: 'fatal' };
  if (e instanceof ErroDownloadIncompleto || e instanceof ErroRede) return { tipo: 'indisponivel', motivo: e.message };
  return { tipo: 'fatal' };
}
