import { supabase } from './supabase';

async function chamarEdge(nome: string, corpo?: unknown): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nome}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
}

export async function iniciarConexaoML(): Promise<void> {
  const resp = await chamarEdge('ml-oauth-start');
  if (!resp.ok) throw new Error(`Falha ao iniciar conexão ML (${resp.status})`);
  const { authUrl } = await resp.json() as { authUrl: string };
  window.location.href = authUrl;
}

/** Confirma a conexão do ML na org da sessão atual (ADR-0091). O callback do OAuth só devolve
 *  um id; é esta chamada, autenticada, que efetivamente grava a conexão. A mensagem de erro vem
 *  da edge function — ela distingue "expirou, recomece" de "conta já está em outra organização",
 *  e o usuário precisa ver a diferença. */
export async function confirmarConexaoML(claimId: string): Promise<{ conta: string | null }> {
  const resp = await chamarEdge('ml-oauth-claim', { claim_id: claimId });
  const json = await resp.json().catch(() => ({})) as { conta?: string | null; mensagem?: string };
  if (!resp.ok) {
    throw new Error(json.mensagem ?? `Falha ao confirmar a conexão do Mercado Livre (${resp.status})`);
  }
  return { conta: json.conta ?? null };
}

export async function desconectarML(): Promise<void> {
  const resp = await chamarEdge('ml-oauth-disconnect');
  if (!resp.ok) throw new Error(`Falha ao desconectar ML (${resp.status})`);
}
