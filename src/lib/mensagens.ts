import { supabase } from './supabase';

export interface Mensagem {
  id: string;
  pack_id: string;
  order_id: string | null;
  message_id: string;
  direcao: 'recebida' | 'enviada';
  texto: string;
  item_titulo: string | null;
  data_ml: string | null;
}

/** Uma conversa = todas as mensagens de um pack, em ordem cronológica. */
export interface Conversa {
  pack_id: string;
  order_id: string | null;
  item_titulo: string | null;
  mensagens: Mensagem[];
  /** Aguardando resposta = a última mensagem é do comprador (ainda não respondemos). ADR-0067. */
  aguardando: boolean;
  ultima: string | null;
}

/** Lê as mensagens (cronológica) e agrupa por pack. Conversas aguardando resposta primeiro. */
export async function buscarConversas(): Promise<Conversa[]> {
  const { data, error } = await supabase
    .from('ml_mensagens')
    .select('id, pack_id, order_id, message_id, direcao, texto, item_titulo, data_ml')
    .order('data_ml', { ascending: true });
  if (error) throw new Error(error.message);
  const lista = (data ?? []) as Mensagem[];

  const porPack = new Map<string, Conversa>();
  for (const m of lista) {
    let c = porPack.get(m.pack_id);
    if (!c) {
      c = { pack_id: m.pack_id, order_id: m.order_id, item_titulo: m.item_titulo, mensagens: [], aguardando: false, ultima: null };
      porPack.set(m.pack_id, c);
    }
    c.mensagens.push(m);
    if (m.item_titulo && !c.item_titulo) c.item_titulo = m.item_titulo;
    c.ultima = m.data_ml;
  }
  const conversas = [...porPack.values()];
  // Aguardando = última mensagem (cronológica) é do comprador — some quando há resposta nossa
  // (pelo PubliAI OU pelo painel do ML, que o backfill/webhook traz como 'enviada').
  for (const c of conversas) {
    const ultima = c.mensagens[c.mensagens.length - 1];
    c.aguardando = ultima?.direcao === 'recebida';
  }
  // Aguardando no topo; depois mais recentes.
  return conversas.sort((a, b) =>
    Number(b.aguardando) - Number(a.aguardando) || (b.ultima ?? '').localeCompare(a.ultima ?? ''));
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

export function responderMensagem(pack_id: string, text: string): Promise<{ ok: true }> {
  return postEdge('responder-mensagem', { pack_id, text });
}

/** Sugestão de IA — reusa a mesma função de perguntas (texto do comprador + título do item). */
export function sugerirRespostaMensagem(texto: string, item_titulo: string | null): Promise<{ ok: true; sugestao: string }> {
  return postEdge('sugerir-resposta-pergunta', { pergunta: texto, item_titulo });
}
