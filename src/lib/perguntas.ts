import { supabase } from './supabase';

export interface Pergunta {
  id: string;
  question_id: number;
  item_id: string | null;
  item_titulo: string | null;
  texto: string;
  status: string;
  resposta: string | null;
  respondida_em: string | null;
  criada_em: string | null;
}

/** Lê as perguntas (não respondidas primeiro). RLS por user. */
export async function buscarPerguntas(): Promise<Pergunta[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => any })
    .from('ml_perguntas')
    .select('id, question_id, item_id, item_titulo, texto, status, resposta, respondida_em, criada_em')
    .order('criada_em', { ascending: false });
  if (error) throw new Error(error.message);
  const lista = (data ?? []) as Pergunta[];
  // Não respondidas no topo.
  return lista.sort((a, b) => Number(b.status === 'UNANSWERED') - Number(a.status === 'UNANSWERED'));
}

async function postEdge<T>(fn: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || json?.ok === false) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  if (json == null) throw new Error('Resposta inválida do servidor');
  return json as T;
}

export function responderPergunta(question_id: number, text: string): Promise<{ ok: true }> {
  return postEdge('responder-pergunta', { question_id, text });
}

export function sugerirResposta(pergunta: string, item_titulo: string | null): Promise<{ ok: true; sugestao: string }> {
  return postEdge('sugerir-resposta-pergunta', { pergunta, item_titulo });
}
