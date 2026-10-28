// Fila do pós-venda (ADR-0192): classificação, ordem e travas. Funções puras; `agora` sempre injetado.
import type { AcaoPendente } from './devolucoes';
import type { AcaoPosvenda } from './posvenda';

export type ItemFila = {
  claim_id: number;
  status: string | null;
  type: string | null;
  return_id?: number | null;
  vez_de?: 'vendedor' | 'comprador' | 'ml' | null;
  revisao_pendente?: boolean;
  prazo?: string | null;
  acoes_pendentes: AcaoPendente[] | null;
};

export type ClasseFila = 'urgente' | 'andamento' | 'concluida';

/** Revisão pendente é urgente mesmo com o claim `closed` (a revisão segue aberta no ML). */
export function classificar(d: ItemFila): ClasseFila {
  if (d.revisao_pendente) return 'urgente';
  if (d.status !== 'opened') return 'concluida';
  if (d.vez_de === 'vendedor' || (d.acoes_pendentes ?? []).some((a) => a.mandatory)) return 'urgente';
  return 'andamento';
}

/** Vencidas, depois `prazo` asc, sem prazo no fim. Não muta a entrada. */
export function ordenarFila<T extends { prazo?: string | null }>(ds: T[], agora: Date): T[] {
  const t = (d: T) => (d.prazo ? Date.parse(d.prazo) : Infinity);
  const venc = (d: T) => (t(d) < agora.getTime() ? 0 : 1);
  return [...ds].sort((a, b) => venc(a) - venc(b) || t(a) - t(b));
}

/** Reclamações = mediations, cancel_purchase e returns sem return_id (e qualquer tipo desconhecido,
 *  para nada sumir da fila); Devoluções = returns com return_id. */
export function subAbaDe(d: Pick<ItemFila, 'type' | 'return_id'>): 'reclamacoes' | 'devolucoes' {
  return d.type === 'returns' && d.return_id != null ? 'devolucoes' : 'reclamacoes';
}

// Espelho de `ACAO_ML`/`chaveRecurso`/`mlAceitaAinda` em supabase/functions/_shared/faturamento/posvenda.ts
// (o front não importa de supabase/functions): manter os dois iguais.
export const ACAO_ML: Record<AcaoPosvenda, string[]> = {
  revisar_ok: ['return_review_ok'],
  revisar_falha: ['return_review_fail'],
  responder: ['send_message_to_complainant', 'send_message_to_mediator'],
  reembolsar: ['refund'],
  reembolso_parcial: ['allow_partial_refund'],
  autorizar_devolucao: ['allow_return', 'allow_return_label'],
  abrir_disputa: ['open_dispute'],
};

const ehRevisao = (a: AcaoPosvenda) => a === 'revisar_ok' || a === 'revisar_falha';

/** O ML libera a ação agora? (`available_actions`; revisão também com algum pedido `pending`). */
export function acaoLiberada(
  acao: AcaoPosvenda, d: { acoes: string[]; revisoes: Array<{ seller_status: string | null }> },
): boolean {
  if (ACAO_ML[acao].some((a) => d.acoes.includes(a))) return true;
  return ehRevisao(acao) && d.revisoes.some((r) => r.seller_status === 'pending');
}

export function chaveRecurso(acao: AcaoPosvenda, claimId: number | string, returnId: number | string | null): string {
  if (ehRevisao(acao)) return `return:${returnId}`;
  if (acao === 'responder') return `claim:${claimId}:msg`;
  return `claim:${claimId}:resolucao`;
}

export type TentativaAtiva = { recurso: string; claim_id: number; estado: string };

/** Há tentativa em aberto (reservada|enviada|desconhecido) no recurso desta ação? */
export function travada(
  ativas: TentativaAtiva[], acao: AcaoPosvenda, claimId: number, returnId: number | null,
): boolean {
  const r = chaveRecurso(acao, claimId, returnId);
  return ativas.some((t) => t.recurso === r);
}

// ---- Filtros dos contadores (Urgentes / Em andamento e sub-itens) ----
export type FiltroFila = 'urgente' | 'andamento' | 'revisar' | 'sua_vez' | 'a_caminho' | 'vez_comprador';

export function filtroCasa(f: FiltroFila, d: ItemFila & { return_status?: string | null }): boolean {
  const c = classificar(d);
  switch (f) {
    case 'urgente': return c === 'urgente';
    case 'andamento': return c === 'andamento';
    case 'revisar': return !!d.revisao_pendente;
    case 'sua_vez': return c === 'urgente' && !d.revisao_pendente;
    case 'a_caminho': return c === 'andamento' && d.return_status === 'shipped';
    case 'vez_comprador': return c === 'andamento' && d.vez_de === 'comprador';
  }
}

// ---- Rótulos do retorno (para o vendedor decidir) ----
const RETORNO: Record<string, string> = {
  pending: 'Aguardando envio', ready_to_ship: 'Pronto para postar', shipped: 'A caminho', delivered: 'Entregue',
  cancelled: 'Cancelado', expired: 'Expirado', failed: 'Falhou', not_delivered: 'Não entregue', label_generated: 'Etiqueta gerada',
};
const DINHEIRO: Record<string, string> = { refunded: 'Reembolsado', retained: 'Retido', onhold: 'Em espera' };
export const labelRetorno = (s: string | null | undefined) => (s ? RETORNO[s] ?? s : '—');
export const labelDinheiro = (s: string | null | undefined) => (s ? DINHEIRO[s] ?? s : '—');

// ---- Produto do pedido (ml_vendas_itens) ----
export type ItemPedido = {
  id: string; ml_item_id: string | null; variation_id: number | null; titulo: string | null;
  codigo: string | null; ean: string | null; quantity: number; unit_price: number;
};
export type ProdutoPedido = { titulo: string; quantidade: number; valor: number; fotoPath: string | null };

/** Resume os itens do pedido: título do 1º (+N itens), unidades, valor e foto do 1º com foto. */
export function resumirPedido(itens: ItemPedido[], foto: (i: ItemPedido) => string | null): ProdutoPedido | null {
  if (!itens.length) return null;
  const nome = itens[0].titulo ?? 'Produto';
  return {
    titulo: itens.length > 1 ? `${nome} +${itens.length - 1} ${itens.length - 1 === 1 ? 'item' : 'itens'}` : nome,
    quantidade: itens.reduce((s, i) => s + i.quantity, 0),
    valor: itens.reduce((s, i) => s + i.quantity * i.unit_price, 0),
    fotoPath: itens.map(foto).find((p): p is string => !!p) ?? null,
  };
}
