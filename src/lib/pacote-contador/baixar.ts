// ADR-0181 Plano 2a — download binário do zip do mês. NUNCA via functions.invoke(): functions-js 2.106.2
// lê application/zip como texto e corrompe os bytes.
import { supabase } from '@/lib/supabase';
import { ErroDownloadIncompleto } from './tipos';

export type ResultadoDownload = { tipo: 'zip'; bytes: Uint8Array; contaMl: string } | { tipo: 'vazio'; contaMl: string };
export class ErroPacote extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ErroPacote'; }
}
const ehAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

async function lerJson(r: Response): Promise<{ error?: string; vazio?: boolean } | null> {
  try { return await r.json(); } catch (e) { if (ehAbort(e)) throw e; return null; }
}

export async function baixarNotasMes(mes: string, orgEsperada: string, signal?: AbortSignal): Promise<ResultadoDownload> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new ErroPacote('Sessão expirada — entre de novo.', 401);
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/baixar-notas-venda`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ mes }),
  });
  const tipo = r.headers.get('Content-Type') ?? '';
  if (!r.ok || !r.headers.get('X-Org-Id')) {
    const j = tipo.includes('json') ? await lerJson(r) : null;
    throw new ErroPacote(j?.error ?? 'Não foi possível confirmar as notas do mês.', r.status);
  }
  if (r.headers.get('X-Org-Id') !== orgEsperada) {
    throw new ErroPacote('A organização mudou durante o download — gere o pacote de novo.', 409);
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
