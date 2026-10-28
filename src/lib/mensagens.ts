import { supabase } from './supabase';
import { postEdge } from './edge';
import { resumoDaRpc, type ResumoMensagens } from './mensagens-resumo';

export interface Mensagem {
  id: string;
  pack_id: string;
  order_id: string | null;
  message_id: string;
  direcao: 'recebida' | 'enviada';
  texto: string;
  item_titulo: string | null;
  item_id: string | null;
  comprador_nome: string | null;
  comprador_nick: string | null;
  order_status: string | null;
  data_ml: string | null;
  /** Dispensada/tratada localmente (não é a leitura no ML). */
  lida: boolean;
  /** Quando o comprador/vendedor leu no ML (monotônico). Null = ainda não lida lá. */
  lida_ml_em: string | null;
}

/** Uma conversa = todas as mensagens de um pack, em ordem cronológica. */
export interface Conversa {
  pack_id: string;
  order_id: string | null;
  item_titulo: string | null;
  item_id: string | null;
  comprador_nome: string | null;
  comprador_nick: string | null;
  order_status: string | null;
  mensagens: Mensagem[];
  /** Aguardando resposta = última mensagem do comprador, não lida, em pedido não cancelado. ADR-0067. */
  aguardando: boolean;
  ultima: string | null;
  /** Situação de envio do pedido (`ml_vendas.shipping_status`); null se a venda não está sincronizada. */
  shipping_status: string | null;
  /** Ids das recebidas ainda não lidas no ML (`lida_ml_em` nulo). */
  idsNaoLidosML: string[];
}

/** Situação de envio de cada conversa, de `ml_vendas` (RLS por org) pelo order_id. Falha na leitura
 *  deixa `shipping_status` nulo — a lista segue funcionando, só sem o rótulo da venda. */
async function preencherEnvio(conversas: Conversa[]): Promise<void> {
  const ids = [...new Set(conversas.map((c) => c.order_id).filter((o): o is string => !!o))];
  const porOrder = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('ml_vendas').select('order_id, shipping_status').in('order_id', ids.slice(i, i + 100).map(Number));
    for (const v of (data ?? []) as Array<{ order_id: number | string; shipping_status: string | null }>) {
      porOrder.set(String(v.order_id), v.shipping_status);
    }
  }
  for (const c of conversas) c.shipping_status = (c.order_id && porOrder.get(c.order_id)) || null;
}

/** Lê as mensagens (cronológica) e agrupa por pack. Conversas aguardando resposta primeiro. */
export async function buscarConversas(): Promise<Conversa[]> {
  const { data, error } = await supabase
    .from('ml_mensagens')
    .select('id, pack_id, order_id, message_id, direcao, texto, item_titulo, item_id, comprador_nome, comprador_nick, order_status, data_ml, lida, lida_ml_em')
    // 1000 últimas mensagens; paginação real se a aba crescer. Ordena desc (mais recentes
    // primeiro) para o .limit() pegar as certas, depois reverte para a ordem cronológica
    // ascendente que o resto da função espera. nullsFirst: false → nulls ficam no FIM do desc,
    // e após o .reverse() acabam no INÍCIO da lista cronológica — nunca decidem `aguardando`/
    // `ultima` de um pack (plan 037).
    .order('data_ml', { ascending: false, nullsFirst: false })
    .order('message_id', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const lista = ((data ?? []) as Mensagem[]).reverse();

  const porPack = new Map<string, Conversa>();
  for (const m of lista) {
    let c = porPack.get(m.pack_id);
    if (!c) {
      c = {
        pack_id: m.pack_id,
        order_id: m.order_id,
        item_titulo: m.item_titulo,
        item_id: m.item_id,
        comprador_nome: m.comprador_nome,
        comprador_nick: m.comprador_nick,
        order_status: m.order_status,
        mensagens: [],
        aguardando: false,
        ultima: null,
        shipping_status: null,
        idsNaoLidosML: [],
      };
      porPack.set(m.pack_id, c);
    }
    c.mensagens.push(m);
    if (m.item_titulo) c.item_titulo = m.item_titulo;
    if (m.item_id) c.item_id = m.item_id;
    if (m.comprador_nome) c.comprador_nome = m.comprador_nome;
    if (m.comprador_nick) c.comprador_nick = m.comprador_nick;
    c.order_status = m.order_status;
    c.ultima = m.data_ml;
  }
  const conversas = [...porPack.values()];
  for (const c of conversas) {
    const ultima = c.mensagens[c.mensagens.length - 1];
    c.aguardando = c.order_status !== 'cancelled' && ultima?.direcao === 'recebida' && ultima?.lida === false;
    c.idsNaoLidosML = c.mensagens.filter((m) => m.direcao === 'recebida' && !m.lida_ml_em).map((m) => m.message_id);
  }
  await preencherEnvio(conversas);
  // Aguardando no topo; depois mais recentes.
  return conversas.sort((a, b) =>
    Number(b.aguardando) - Number(a.aguardando) || (b.ultima ?? '').localeCompare(a.ultima ?? ''));
}

export const ehPedidoCancelado = (e: unknown): boolean =>
  e instanceof Error && (
    (e as Error & { codigo?: string }).codigo === 'pedido_cancelado' ||
    e.message.includes('pedido foi cancelado')
  );

/** Marca as mensagens do pack como lidas NO ML (a leitura volta no próximo sync/refetch). */
export function marcarMensagensLidasML(pack_id: string): Promise<{ ok: true }> {
  return postEdge('marcar-mensagens-lidas-ml', { pack_id });
}

/** Contadores dos cards de resumo, agregados no banco sobre todas as mensagens da org. */
export async function buscarResumoMensagens(): Promise<ResumoMensagens> {
  const { data, error } = await supabase.rpc('resumo_mensagens_posvenda');
  if (error) throw new Error(error.message);
  const linha = (Array.isArray(data) ? data[0] : data) as Parameters<typeof resumoDaRpc>[0] | null;
  return resumoDaRpc(linha ?? { nao_lidas_total: 0, a_preparar: 0, a_caminho: 0, entregues: 0, sem_responder: 0, respondidas: 0 });
}

export function responderMensagem(pack_id: string, text: string): Promise<{ ok: true }> {
  return postEdge('responder-mensagem', { pack_id, text });
}

/** Sugestão de IA — reusa a mesma função de perguntas (texto do comprador + título do item). */
export function sugerirRespostaMensagem(texto: string, item_titulo: string | null): Promise<{ ok: true; sugestao: string }> {
  return postEdge('sugerir-resposta-pergunta', { pergunta: texto, item_titulo });
}

/** Dispensa a conversa: marca as recebidas como lidas, tirando-a de "Aguardando". Reabre sozinha
 *  se o comprador mandar mensagem nova. Retorna quantas linhas foram marcadas. */
export async function dispensarConversa(pack_id: string): Promise<number> {
  const { data, error } = await supabase.rpc('marcar_mensagens_lidas', { p_pack_id: pack_id });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}
