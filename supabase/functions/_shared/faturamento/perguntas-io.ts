// IO de perguntas (ADR-0037): chamadas à API do ML e persistência. Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapearPergunta, type PerguntaML } from './pergunta.ts';

const API = 'https://api.mercadolibre.com';

/** GET /questions/{id}. null em erro. */
export async function buscarPergunta(token: string, questionId: string): Promise<PerguntaML | null> {
  const resp = await fetch(`${API}/questions/${questionId}?api_version=4`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return await resp.json() as PerguntaML;
}

/** Título do anúncio (para exibir junto da pergunta). null em erro. */
export async function buscarTituloItem(token: string, itemId: string | null): Promise<string | null> {
  if (!itemId) return null;
  try {
    const resp = await fetch(`${API}/items/${itemId}?attributes=title`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    return (await resp.json())?.title ?? null;
  } catch { return null; }
}

/** Varre /questions/search do vendedor (api_version=4). Para o backfill. */
export async function buscarPerguntasSeller(token: string): Promise<PerguntaML[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const meResp = await fetch(`${API}/users/me`, { headers });
  if (!meResp.ok) throw new Error(`ML /users/me ${meResp.status}`);
  const seller = (await meResp.json())?.id;
  if (!seller) throw new Error('ML: seller id ausente');

  const out: PerguntaML[] = [];
  const limit = 50;
  let offset = 0;
  while (offset < 2000) {
    const params = new URLSearchParams({ seller_id: String(seller), api_version: '4', sort_fields: 'date_created', sort_types: 'DESC', offset: String(offset), limit: String(limit) });
    const resp = await fetch(`${API}/questions/search?${params}`, { headers });
    if (!resp.ok) { if (offset === 0) throw new Error(`ML /questions ${resp.status}`); break; }
    const data = await resp.json();
    const results: PerguntaML[] = Array.isArray(data?.questions) ? data.questions : [];
    out.push(...results);
    const total = Number(data?.total ?? out.length);
    offset += limit;
    if (results.length === 0 || offset >= total) break;
  }
  return out;
}

/** POST /answers — responde a pergunta no ML. Lança em erro (mostra ao operador). */
export async function responderAnswer(token: string, questionId: number, text: string): Promise<void> {
  const resp = await fetch(`${API}/answers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_id: questionId, text }),
  });
  if (!resp.ok) throw new Error(`ML /answers ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

/** Upsert de uma pergunta. Retorna se virou "nova não respondida" (para alerta). */
export async function upsertPergunta(
  admin: SupabaseClient, userId: string, q: PerguntaML, itemTitulo: string | null,
): Promise<{ novaNaoRespondida: boolean; row: ReturnType<typeof mapearPergunta> }> {
  const row = mapearPergunta(q);
  const { data: anterior } = await admin.from('ml_perguntas')
    .select('status').eq('user_id', userId).eq('question_id', row.question_id).maybeSingle();
  const eraConhecida = !!anterior;
  await admin.from('ml_perguntas').upsert({
    user_id: userId, ...row, item_titulo: itemTitulo,
    raw: q as unknown as Record<string, unknown>, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'user_id,question_id' });
  const novaNaoRespondida = !eraConhecida && row.status === 'UNANSWERED';
  return { novaNaoRespondida, row };
}
