import { supabase } from './supabase';

export interface Pergunta {
  id: string;
  question_id: number;
  item_id: string | null;
  item_titulo: string | null;
  comprador_id: number | null;
  comprador_nick: string | null;
  /** Nome civil, quando o comprador já comprou (vem de `ml_vendas`, não da API de perguntas). */
  comprador_nome: string | null;
  texto: string;
  status: string;
  resposta: string | null;
  respondida_em: string | null;
  criada_em: string | null;
}

/**
 * Nome de quem perguntou. A API de perguntas do ML só devolve o apelido (`OLCA4176283`) — o nome
 * civil só existe em pedido, então sai de `ml_vendas` quando esse comprador já comprou.
 */
async function nomesPorComprador(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('ml_vendas')
    .select('comprador_id, comprador_nome')
    .in('comprador_id', ids)
    .not('comprador_nome', 'is', null);
  const mapa = new Map<number, string>();
  for (const v of data ?? []) {
    if (v.comprador_id != null && v.comprador_nome) mapa.set(Number(v.comprador_id), v.comprador_nome);
  }
  return mapa;
}

/** Lê as perguntas (não respondidas primeiro). RLS por user. */
export async function buscarPerguntas(): Promise<Pergunta[]> {
  const { data, error } = await supabase
    .from('ml_perguntas')
    .select('id, question_id, item_id, item_titulo, comprador_id, comprador_nick, texto, status, resposta, respondida_em, criada_em')
    .order('criada_em', { ascending: false });
  if (error) throw new Error(error.message);
  const lista = (data ?? []) as Pergunta[];
  const nomes = await nomesPorComprador([...new Set(lista.map((p) => p.comprador_id).filter((i): i is number => i != null))]);
  // Não respondidas no topo.
  return lista
    .map((p) => ({ ...p, comprador_nome: (p.comprador_id != null ? nomes.get(p.comprador_id) : null) ?? null }))
    .sort((a, b) => Number(b.status === 'UNANSWERED') - Number(a.status === 'UNANSWERED'));
}

export type FiltroStatusPergunta = 'pendentes' | 'respondidas' | 'todas';

export interface FiltroPerguntas {
  status?: FiltroStatusPergunta;
}

export interface PaginaPerguntas {
  itens: Pergunta[];
  total: number;
}

/** Mesmo recorte do filtro server-side, mas em memória — usado por Exportar, que sempre lê a
 *  lista inteira via buscarPerguntas(), independente da página/aba aberta na tela. */
export function pergCasaStatus(status: string, filtro: FiltroStatusPergunta): boolean {
  if (filtro === 'pendentes') return status === 'UNANSWERED';
  if (filtro === 'respondidas') return status !== 'UNANSWERED';
  return true;
}

const COLUNAS_PERGUNTA =
  'id, question_id, item_id, item_titulo, comprador_id, comprador_nick, texto, status, resposta, respondida_em, criada_em';

/** Uma página de perguntas. A separação por status virou aba (ver AbaPerguntas) — aqui a ordem é
 *  sempre por data, mais recente primeiro. RLS por user. */
export async function fetchPerguntasPagina(
  pagina = 1,
  tamanho = 20,
  filtro: FiltroPerguntas = {},
): Promise<PaginaPerguntas> {
  const de = (Math.max(1, Math.floor(pagina) || 1) - 1) * tamanho;
  let q = supabase.from('ml_perguntas').select(COLUNAS_PERGUNTA, { count: 'exact' });
  if (filtro.status === 'pendentes') q = q.eq('status', 'UNANSWERED');
  else if (filtro.status === 'respondidas') q = q.neq('status', 'UNANSWERED');

  const { data, error, count } = await q
    .order('criada_em', { ascending: false })
    .range(de, de + tamanho - 1);
  if (error) throw new Error(error.message);

  const lista = (data ?? []) as Pergunta[];
  const nomes = await nomesPorComprador(
    [...new Set(lista.map((p) => p.comprador_id).filter((i): i is number => i != null))],
  );
  const itens = lista.map((p) => ({
    ...p,
    comprador_nome: (p.comprador_id != null ? nomes.get(p.comprador_id) : null) ?? null,
  }));
  return { itens, total: count ?? 0 };
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
