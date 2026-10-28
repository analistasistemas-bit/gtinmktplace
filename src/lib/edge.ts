import { supabase } from './supabase';

/** POST autenticado (JWT da sessão) numa Edge Function; erro `{ ok:false, erro, codigo? }` vira Error. */
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
    const err = new Error(json?.erro ?? `Falha (${resp.status})`);
    if (json?.codigo) (err as Error & { codigo?: string }).codigo = json.codigo;
    throw err;
  }
  if (json == null) throw new Error('Resposta inválida do servidor');
  return json as T;
}
