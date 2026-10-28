import { supabase } from './supabase';

/** Erro de `postEdge`: `codigo` e `pendente` (409 de trava do posvenda-acao) vêm do corpo da edge. */
export type ErroEdge = Error & { codigo?: string; pendente?: unknown };

/** POST autenticado (JWT da sessão) numa Edge Function; erro `{ ok:false, erro, codigo?, pendente? }` vira ErroEdge. */
export async function postEdge<T>(fn: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || json?.ok === false) {
    const err: ErroEdge = new Error(json?.erro ?? `Falha (${resp.status})`);
    if (json?.codigo) err.codigo = json.codigo;
    if (json?.pendente) err.pendente = json.pendente;
    throw err;
  }
  if (json == null) throw new Error('Resposta inválida do servidor');
  return json as T;
}
