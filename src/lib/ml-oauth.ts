import { supabase } from './supabase';

async function chamarEdge(nome: string): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nome}`;
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
}

export async function iniciarConexaoML(): Promise<void> {
  const resp = await chamarEdge('ml-oauth-start');
  if (!resp.ok) throw new Error(`Falha ao iniciar conexão ML (${resp.status})`);
  const { authUrl } = await resp.json() as { authUrl: string };
  window.location.href = authUrl;
}

export async function desconectarML(): Promise<void> {
  const resp = await chamarEdge('ml-oauth-disconnect');
  if (!resp.ok) throw new Error(`Falha ao desconectar ML (${resp.status})`);
}
