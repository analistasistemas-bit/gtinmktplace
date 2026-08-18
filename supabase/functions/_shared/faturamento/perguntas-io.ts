// IO de perguntas (ADR-0037): chamadas à API do ML e persistência. Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapearPergunta, preservarComprador, type PerguntaML } from './pergunta.ts';
import { MLApiError } from '../ml/erro-ml.ts';
import { chunk } from './utils.ts';
import type { PerguntaLocal } from './reconciliar-filtros.ts';

const API = 'https://api.mercadolibre.com';

/** GET /questions/{id}. Lança MLApiError(status) em erro (caller classifica via classificarErroML). */
export async function buscarPergunta(token: string, questionId: string): Promise<PerguntaML> {
  const resp = await fetch(`${API}/questions/${questionId}?api_version=4`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new MLApiError(resp.status, `ML /questions/${questionId} ${resp.status}`);
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

/**
 * Nickname de quem perguntou. O ML v4 parou de mandar `from.nickname` (só o `id`), então o nome
 * só sai de `GET /users/{id}`. O mesmo comprador repete entre perguntas, daí o cache.
 *
 * Escopo de MÓDULO: em edge function isso vale por **isolate**, não por invocação — o Map
 * sobrevive entre execuções enquanto o isolate estiver quente.
 */
const nicksCache = new Map<number, string | null>();

export async function buscarNickname(token: string, userId: number): Promise<string | null> {
  const emCache = nicksCache.get(userId);
  if (emCache !== undefined) return emCache;
  let nick: string | null = null;
  let falhou = false;
  try {
    const resp = await fetch(`${API}/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.ok) nick = (await resp.json())?.nickname?.trim() || null;
    else falhou = true;
  } catch { falhou = true; /* nome é enfeite: pergunta sem nick continua utilizável */ }
  // Só cacheia RESPOSTA, nunca falha: como o cache é por isolate, guardar o erro de uma queda
  // momentânea do ML fixaria "sem nickname" para aquele comprador até o isolate reciclar, e
  // nenhum retry recuperaria. Resposta ok com nickname vazio É informação — essa entra no cache.
  if (!falhou) nicksCache.set(userId, nick);
  return nick;
}

/** Upsert de uma pergunta. Retorna se virou "nova não respondida" (para alerta). */
export async function upsertPergunta(
  admin: SupabaseClient, userId: string, orgId: string | null, q: PerguntaML, itemTitulo: string | null,
  token?: string,
): Promise<{ novaNaoRespondida: boolean; row: ReturnType<typeof mapearPergunta> }> {
  const row = mapearPergunta(q);
  const { data: anterior } = await admin.from('ml_perguntas')
    .select('status, comprador_id, comprador_nick').eq('user_id', userId).eq('question_id', row.question_id).maybeSingle();
  const eraConhecida = !!anterior;
  const comprador = preservarComprador(row, anterior);
  if (!comprador.comprador_nick && comprador.comprador_id && token) {
    comprador.comprador_nick = await buscarNickname(token, comprador.comprador_id);
  }
  await admin.from('ml_perguntas').upsert({
    user_id: userId, org_id: orgId, ...row, ...comprador, item_titulo: itemTitulo,
    raw: q as unknown as Record<string, unknown>, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'user_id,question_id' });
  const novaNaoRespondida = !eraConhecida && row.status === 'UNANSWERED';
  return { novaNaoRespondida, row };
}

/**
 * Estado local das perguntas informadas, para o reconciliar decidir quais precisam de upsert
 * (`perguntaPrecisaUpsert`). Uma consulta em lote no lugar de um SELECT por pergunta.
 *
 * Em lotes porque o `in.()` vai na URL (que tem teto de tamanho no PostgREST) e a resposta é
 * limitada a 1000 linhas — `buscarPerguntasSeller` pagina até 2000.
 */
export async function carregarPerguntasLocais(
  admin: SupabaseClient, userId: string, questionIds: number[],
): Promise<Map<number, PerguntaLocal>> {
  const mapa = new Map<number, PerguntaLocal>();
  for (const lote of chunk(questionIds, 200)) {
    const { data } = await admin.from('ml_perguntas')
      .select('question_id, status, resposta, item_titulo, comprador_id, comprador_nick')
      .eq('user_id', userId).in('question_id', lote);
    for (const r of data ?? []) mapa.set(Number(r.question_id), r as unknown as PerguntaLocal);
  }
  return mapa;
}
