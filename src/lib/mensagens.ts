import { supabase } from './supabase';
import { postEdge } from './edge';
import { resumoDaRpc, type ResumoMensagens } from './mensagens-resumo';

/** Anexo de mensagem do ML (`raw.message_attachments`). `filename` é o id para baixar. */
export interface AnexoMensagem {
  filename: string;
  original_filename: string | null;
  type: string | null;
  size: number | null;
  potential_security_threat: boolean;
}

export interface EnvioPendente { operacao_id: string; estado: string }

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
  anexos: AnexoMensagem[];
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
  /** Estado do pack em `ml_conversas` (`conversation_status.status` do ML); null = ainda não observado. */
  conversa_status: string | null;
  mensagens: Mensagem[];
  /** Aguardando resposta = última mensagem do comprador, não lida, em conversa não encerrada. ADR-0067. */
  aguardando: boolean;
  ultima: string | null;
  /** Situação de envio do pedido (`ml_vendas.shipping_status`); null se a venda não está sincronizada. */
  shipping_status: string | null;
  /** Ids das recebidas ainda não lidas no ML (`lida_ml_em` nulo). */
  idsNaoLidosML: string[];
  /** Pedido do pack com reclamação (mediations) aberta: o ML bloqueia a mensagem (`blocked_by_claim`);
   *  a conversa segue pela reclamação e não conta como aguardando. Emenda ADR-0067 (01/11). */
  reclamacaoAberta: boolean;
  /** Tentativa de envio ainda ativa (reservada/enviada/desconhecido) em `ml_posvenda_acoes`. */
  envioPendente: EnvioPendente | null;
}

/** Conversa encerrada pelo ML: pedido cancelado e o ML não a informou como ativa (`conversa_status`
 *  null = ainda não observada conta como encerrada). Emenda ADR-0067 (23/11): parte das conversas de
 *  pedido cancelado segue ativa. Mesma regra das RPCs `contar_conversas_aguardando`/`resumo_mensagens_posvenda`. */
export function conversaEncerrada(c: Pick<Conversa, 'order_status' | 'conversa_status'>): boolean {
  return c.order_status === 'cancelled' && c.conversa_status !== 'active';
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

/** Estado de cada conversa em `ml_conversas` (RLS por org), pelos packs carregados em lotes de 100.
 *  Falha na leitura deixa null — conversa de pedido cancelado segue encerrada (lado seguro). */
async function preencherEstadoConversa(conversas: Conversa[]): Promise<void> {
  const packs = conversas.map((c) => c.pack_id);
  const porPack = new Map<string, string>();
  for (let i = 0; i < packs.length; i += 100) {
    const { data } = await supabase.from('ml_conversas').select('pack_id, status').in('pack_id', packs.slice(i, i + 100));
    for (const r of (data ?? []) as Array<{ pack_id: string; status: string }>) porPack.set(r.pack_id, r.status);
  }
  for (const c of conversas) c.conversa_status = porPack.get(c.pack_id) ?? null;
}

/** Marca as conversas cujo pedido (`order_id` de alguma mensagem, ou o `pack_id` em pedido solo)
 *  tem reclamação `mediations` aberta em `ml_devolucoes` (RLS por org). Falha na leitura deixa
 *  todas como sem reclamação — a lista segue; o 409 `reclamacao_aberta` da edge trava na hora. */
async function preencherReclamacao(conversas: Conversa[]): Promise<void> {
  const { data } = await supabase.from('ml_devolucoes').select('order_id')
    .eq('status', 'opened').eq('type', 'mediations');
  const abertas = new Set(((data ?? []) as Array<{ order_id: number | string }>).map((d) => String(d.order_id)));
  for (const c of conversas) {
    c.reclamacaoAberta = abertas.has(c.pack_id) || c.mensagens.some((m) => !!m.order_id && abertas.has(m.order_id));
    if (c.reclamacaoAberta) c.aguardando = false;
  }
}

const ESTADOS_ATIVOS = ['reservada', 'enviada', 'desconhecido'];

/** Envio de mensagem ainda ativo por pack (`ml_posvenda_acoes`, RLS por org). `pack_id` ainda não está
 *  em database.types.ts: cast, como em posvenda.ts. Falha na leitura deixa tudo null — a lista segue. */
async function preencherEnvioPendente(conversas: Conversa[]): Promise<void> {
  const { data, error } = await supabase.from('ml_posvenda_acoes')
    .select('pack_id, operacao_id, estado')
    .in('estado', ESTADOS_ATIVOS)
    .not('pack_id', 'is', null);
  const porPack = new Map<string, EnvioPendente>();
  if (!error) {
    for (const a of (data ?? []) as unknown as Array<{ pack_id: string } & EnvioPendente>) {
      porPack.set(String(a.pack_id), { operacao_id: a.operacao_id, estado: a.estado });
    }
  }
  for (const c of conversas) c.envioPendente = porPack.get(c.pack_id) ?? null;
}

/** Envio ativo de um pack (ao abrir o card). Vazio ou erro de leitura -> null: a tela segue. */
export async function buscarEnvioPendente(pack_id: string): Promise<EnvioPendente | null> {
  const { data, error } = await supabase.from('ml_posvenda_acoes')
    .select('pack_id, operacao_id, estado')
    .filter('pack_id', 'eq', pack_id) // pack_id ainda fora de database.types.ts
    .in('estado', ESTADOS_ATIVOS)
    .limit(1);
  if (error) return null;
  const a = ((data ?? []) as unknown as EnvioPendente[])[0];
  return a ? { operacao_id: a.operacao_id, estado: a.estado } : null;
}

/** Lê as mensagens (cronológica) e agrupa por pack. Conversas aguardando resposta primeiro. */
export async function buscarConversas(): Promise<Conversa[]> {
  const { data, error } = await supabase
    .from('ml_mensagens')
    .select('id, pack_id, order_id, message_id, direcao, texto, item_titulo, item_id, comprador_nome, comprador_nick, order_status, data_ml, lida, lida_ml_em, anexos:raw->message_attachments')
    // 1000 últimas mensagens; paginação real se a aba crescer. Ordena desc (mais recentes
    // primeiro) para o .limit() pegar as certas, depois reverte para a ordem cronológica
    // ascendente que o resto da função espera. nullsFirst: false → nulls ficam no FIM do desc,
    // e após o .reverse() acabam no INÍCIO da lista cronológica — nunca decidem `aguardando`/
    // `ultima` de um pack (plan 037).
    .order('data_ml', { ascending: false, nullsFirst: false })
    .order('message_id', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const lista = ((data ?? []) as unknown as Mensagem[]).reverse();
  for (const m of lista) m.anexos = Array.isArray(m.anexos) ? m.anexos : [];

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
        conversa_status: null,
        mensagens: [],
        aguardando: false,
        ultima: null,
        shipping_status: null,
        idsNaoLidosML: [],
        reclamacaoAberta: false,
        envioPendente: null,
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
  await preencherEstadoConversa(conversas);
  for (const c of conversas) {
    const ultima = c.mensagens[c.mensagens.length - 1];
    c.aguardando = !conversaEncerrada(c) && ultima?.direcao === 'recebida' && ultima?.lida === false;
    c.idsNaoLidosML = c.mensagens.filter((m) => m.direcao === 'recebida' && !m.lida_ml_em).map((m) => m.message_id);
  }
  await preencherEnvio(conversas);
  await preencherReclamacao(conversas);
  await preencherEnvioPendente(conversas);
  // Aguardando no topo; depois mais recentes.
  return conversas.sort((a, b) =>
    Number(b.aguardando) - Number(a.aguardando) || (b.ultima ?? '').localeCompare(a.ultima ?? ''));
}

export const ehReclamacaoAberta = (e: unknown): boolean =>
  e instanceof Error && (e as Error & { codigo?: string }).codigo === 'reclamacao_aberta';

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
  const linha = Array.isArray(data) ? data[0] : data;
  return resumoDaRpc(linha ?? { nao_lidas_total: 0, a_preparar: 0, a_caminho: 0, entregues: 0, sem_responder: 0, respondidas: 0 });
}

export interface RespostaEnvio { ok: true; estado: string; operacao_id: string; pendenteConfirmacao: boolean }

/** `opcoes` = tentativa já reservada (reenvio com a mesma `operacao_id`) e anexo (filename do upload). */
export function responderMensagem(pack_id: string, text: string, opcoes?: { operacao_id: string; anexo: string | null }): Promise<RespostaEnvio> {
  return postEdge('responder-mensagem', opcoes ? { pack_id, text, ...opcoes } : { pack_id, text });
}

/** Reconfere no ML se a tentativa pendente foi entregue. */
export function verificarEnvio(pack_id: string, operacao_id: string): Promise<RespostaEnvio> {
  return postEdge('responder-mensagem', { pack_id, operacao_id, verificar: true });
}

/** Libera a trava de uma tentativa pendente para permitir novo envio. */
export function liberarEnvio(pack_id: string, operacao_id: string): Promise<RespostaEnvio> {
  return postEdge('responder-mensagem', { pack_id, operacao_id, liberar: true });
}

/** Sobe o arquivo para o pack e devolve o `filename` a mandar em `responderMensagem`. */
export async function enviarAnexoMensagem(pack_id: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append('destino', 'mensagem_pack');
  fd.append('pack_id', pack_id);
  fd.append('file', file);
  const r = await postEdge<{ ok: true; nome: string }>('posvenda-anexo', fd);
  return r.nome;
}

/** Baixa o anexo recebido (fetch autenticado; a edge devolve os bytes). Erro leva `codigo` (ex. `anexo_indisponivel`). */
export function baixarAnexoMensagem(pack_id: string, filename: string): Promise<Blob> {
  return baixarAnexo({ pack_id, filename });
}

/** Baixa o anexo de uma mensagem da reclamação (ex.: foto que a compradora mandou ao mediador). */
export function baixarAnexoReclamacao(claim_id: string, filename: string): Promise<Blob> {
  return baixarAnexo({ claim_id, filename });
}

async function baixarAnexo(corpo: { pack_id: string; filename: string } | { claim_id: string; filename: string }): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/posvenda-anexo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) {
    const json = await resp.json().catch(() => null);
    const err: Error & { codigo?: string } = new Error(json?.erro ?? `Falha (${resp.status})`);
    if (json?.codigo) err.codigo = json.codigo;
    throw err;
  }
  return resp.blob();
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
