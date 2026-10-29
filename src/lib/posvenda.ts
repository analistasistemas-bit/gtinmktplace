import { postEdge, type ErroEdge } from './edge';
import { supabase } from './supabase';
import { COLUNAS_DEVOLUCAO, type Devolucao } from './devolucoes';
import type { ItemPedido, TentativaAtiva } from './posvenda-fila';

/** Espelho de `DetalheReclamacao` em supabase/functions/_shared/faturamento/posvenda.ts. */
export interface DetalheReclamacao {
  claim_id: number;
  return_id: number | null;
  stage: string | null;
  status: string | null;
  estado: {
    titulo: string | null; descricao: string | null; problema: string | null;
    prazo: string | null; vez_de: 'vendedor' | 'comprador' | 'ml' | null;
  };
  comprador_quer: string | null;
  resolucoes: Array<{
    papel: string; tipo: string; status: string;
    detalhes: Array<{ chave: string; valor: string }>;
    criada_em: string; atualizada_em: string;
  }>;
  resolucao_final: { motivo: string | null; data: string | null } | null;
  afeta_reputacao: string | null;
  custo_devolucao: number | null;
  historico: Array<{
    data: string; autor: 'comprador' | 'vendedor' | 'ml'; destinatario: 'comprador' | 'vendedor' | 'ml' | null;
    texto: string; anexos: Array<{ id: string; nome: string }>; status: string | null; moderacao: string | null;
  }>;
  acoes: string[];
  revisoes: Array<{ order_id: number; seller_status: string | null }>;
  pedidos_devolucao: number[];
  motivos_falha_revisao: Array<{ id: string; texto: string; exige_foto: boolean; aplica: string[] }>;
  reembolso_parcial: { ofertas: Array<{ percentual: number; valor: number }>; minimo: number | null } | null;
  /** Leituras informativas que falharam (o campo correspondente vem null/vazio). */
  incompleto: string[];
}

export type AcaoPosvenda =
  | 'revisar_ok' | 'revisar_falha' | 'responder' | 'reembolsar' | 'reembolso_parcial'
  | 'autorizar_devolucao' | 'abrir_disputa';

export type EstadoAcaoPosvenda =
  | 'reservada' | 'enviada' | 'confirmada' | 'recusada' | 'desconhecido' | 'inconclusiva' | 'cancelada';

/** Espelho de `BodyAcao` (posvenda-fluxo.ts). `operacao_id` é gerado ao ABRIR o diálogo e reusado em
 *  qualquer repetição/"Conferir" — é ele que impede o segundo POST. */
export interface BodyAcaoPosvenda {
  operacao_id: string;
  claim_id: string;
  acao: AcaoPosvenda;
  texto?: string;
  percentual?: number;
  revisoes?: Array<{ order_id?: number; motivo_id: string; texto: string; anexos: string[] }>;
  anexos?: string[];
}

export interface ResultadoAcaoPosvenda {
  ok: true;
  estado: EstadoAcaoPosvenda;
  operacao_id: string;
  /** true = o ML ainda não confirmou (mostrar "Conferir no ML"); a trava segue no item. */
  pendenteConfirmacao: boolean;
  sincronizacaoPendente: boolean;
  devolucao: Record<string, unknown> | null;
}

/** Executa a ação no ML. Erros (`ok:false`) viram Error com `codigo`: `em_andamento`, `recusada`,
 *  `cancelada`, `reconectar`, `moderacao`. */
export function executarAcaoPosvenda(body: BodyAcaoPosvenda): Promise<ResultadoAcaoPosvenda> {
  return postEdge<ResultadoAcaoPosvenda>('posvenda-acao', body);
}

/** 409 de trava: a tentativa em aberto no item (para a UI oferecer "Conferir" com esse operacao_id). */
export function ehAcaoPendente(e: unknown): { operacao_id: string; acao: AcaoPosvenda; estado: EstadoAcaoPosvenda } | null {
  const p = (e as ErroEdge | null)?.pendente as Record<string, unknown> | null | undefined;
  if (!(e instanceof Error) || !p || typeof p !== 'object') return null;
  if (typeof p.operacao_id !== 'string' || typeof p.acao !== 'string' || typeof p.estado !== 'string') return null;
  return { operacao_id: p.operacao_id, acao: p.acao as AcaoPosvenda, estado: p.estado as EstadoAcaoPosvenda };
}

/** Erro da edge que traz um estado TERMINAL da tentativa (ex.: "Conferir" → 422 recusada por moderação).
 *  A UI aplica esse estado em vez de tratar como falha de leitura. null = erro sem estado terminal. */
export function estadoTerminalDoErro(e: unknown): 'recusada' | 'cancelada' | 'inconclusiva' | null {
  const s = (e as ErroEdge | null)?.estado;
  return s === 'recusada' || s === 'cancelada' || s === 'inconclusiva' ? s : null;
}

/** Só relê o ML para a tentativa já registrada; nunca envia de novo. */
export function verificarAcaoPosvenda(operacaoId: string, claimId: string): Promise<ResultadoAcaoPosvenda> {
  return postEdge<ResultadoAcaoPosvenda>('posvenda-acao', { operacao_id: operacaoId, claim_id: claimId, verificar: true });
}

/** Sobe a foto/PDF para o ML e devolve o identificador do anexo (referenciado depois na ação). */
export async function enviarAnexoPosvenda(claimId: string, destino: 'revisao' | 'mensagem', file: File): Promise<string> {
  const fd = new FormData();
  fd.append('claim_id', claimId);
  fd.append('destino', destino);
  fd.append('file', file);
  const r = await postEdge<{ ok: true; nome: string }>('posvenda-anexo', fd);
  return r.nome;
}

/** Estado da reclamação relido do ML agora (nunca do cache local). */
export async function buscarDetalheReclamacao(claimId: string): Promise<DetalheReclamacao> {
  const r = await postEdge<{ ok: true; detalhe: DetalheReclamacao }>('posvenda-detalhe', { claim_id: claimId });
  return r.detalhe;
}

const PAGINA = 1000;

/** Fila do pós-venda: só o que está aberto ou com revisão pendente (conjunto pequeno), paginado até
 *  esgotar. Nunca depende do histórico (buscarDevolucoes). */
export async function buscarFilaPosvenda(): Promise<Devolucao[]> {
  const out: Devolucao[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('ml_devolucoes')
      .select(COLUNAS_DEVOLUCAO)
      .or('status.eq.opened,revisao_pendente.eq.true')
      .order('claim_id', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as unknown as Devolucao[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
}

export type TentativaAtivaPosvenda = TentativaAtiva & { operacao_id: string; acao: AcaoPosvenda; return_id: number | null };

/** Tentativas que seguram a trava do recurso (RLS: membros da org). */
export async function buscarTentativasAtivas(): Promise<TentativaAtivaPosvenda[]> {
  const { data, error } = await supabase
    .from('ml_posvenda_acoes')
    .select('operacao_id, claim_id, return_id, recurso, acao, estado')
    .in('estado', ['reservada', 'enviada', 'desconhecido']);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TentativaAtivaPosvenda[];
}

const LOTE_PEDIDOS = 80;

/** Itens dos pedidos (order_id -> ml_vendas -> ml_vendas_itens): produto, quantidade e valor dos cards. */
export async function buscarProdutosPedidos(orderIds: number[]): Promise<Map<number, { itens: ItemPedido[] }>> {
  const out = new Map<number, { itens: ItemPedido[] }>();
  const ids = [...new Set(orderIds)];
  for (let i = 0; i < ids.length; i += LOTE_PEDIDOS) {
    const { data, error } = await supabase
      .from('ml_vendas')
      .select('order_id, itens:ml_vendas_itens(id, ml_item_id, variation_id, titulo, codigo, ean, quantity, unit_price)')
      .in('order_id', ids.slice(i, i + LOTE_PEDIDOS));
    if (error) throw new Error(error.message);
    for (const v of (data ?? []) as unknown as Array<{ order_id: number; itens: ItemPedido[] | null }>) {
      out.set(Number(v.order_id), { itens: v.itens ?? [] });
    }
  }
  return out;
}
