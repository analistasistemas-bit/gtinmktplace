import { supabase } from './supabase';

export interface AcaoPendente { action: string; due_date: string | null; mandatory: boolean }

export interface Devolucao {
  id: string;
  claim_id: number;
  order_id: number | null;
  stage: string | null;
  status: string | null;
  type: string | null;
  reason_texto: string | null;
  valor_em_jogo: number | null;
  return_status: string | null;
  return_status_money: string | null;
  acoes_pendentes: AcaoPendente[] | null;
  aberto_em: string | null;
  /** Quando o ML resolveu o claim (`resolution.date_created`). É o MESMO instante em que o
   *  dinheiro saiu: conferido contra `payments[].date_last_modified` do pedido em 5 devoluções
   *  reais (ex.: claim 5553795965 fechou 03/08 17:16:36, o pagamento 169615860668 foi estornado
   *  03/08 17:16:41). Null enquanto o claim está aberto. */
  fechado_em: string | null;
  pack_id?: number | null;
  /** Valor já reembolsado via Mercado Pago (ml_vendas.estorno, ADR-0038) — `valor_em_jogo` vem
   *  sempre null da API de claims do ML, que não traz nenhum campo monetário. */
  valor_estornado?: number | null;
}

/** Lê as devoluções/claims (mais recentes primeiro). RLS por user. */
export async function buscarDevolucoes(): Promise<Devolucao[]> {
  const { data, error } = await supabase
    .from('ml_devolucoes')
    .select('id, claim_id, order_id, stage, status, type, reason_texto, valor_em_jogo, return_status, return_status_money, acoes_pendentes, aberto_em, fechado_em')
    .order('aberto_em', { ascending: false });
  if (error) throw new Error(error.message);

  const devolucoes = (data ?? []) as Devolucao[];
  const orderIds = devolucoes.map(d => d.order_id).filter((id): id is number => id != null);

  if (orderIds.length > 0) {
    const { data: vendasData, error: vendasError } = await supabase
      .from('ml_vendas')
      .select('order_id, pack_id, estorno')
      .in('order_id', orderIds);
    if (vendasError) throw new Error(vendasError.message);

    if (vendasData) {
      const packMap = new Map(vendasData.map(v => [v.order_id, v.pack_id]));
      const estornoMap = new Map(vendasData.map(v => [v.order_id, v.estorno]));
      devolucoes.forEach(d => {
        if (d.order_id != null) {
          d.pack_id = packMap.get(d.order_id) ?? null;
          d.valor_estornado = estornoMap.get(d.order_id) ?? null;
        }
      });
    }
  }

  return devolucoes;
}

/** A data que põe a devolução num período: a do estorno quando já houve resolução, senão a da
 *  abertura (claim em curso, ou linha antiga que o backfill não alcançou). ADR-0106 — usada
 *  tanto pelo card do Dashboard quanto pelo filtro da aba Devoluções, para os dois não
 *  divergirem no mesmo período. */
export const dataNoPeriodo = (d: Devolucao): string | null => d.fechado_em ?? d.aberto_em;

/** Order IDs com claim de devolução real (type=returns), não mediação/cancelamento. */
export function orderIdsComDevolucaoReal(
  devolucoes: Pick<Devolucao, 'order_id' | 'type'>[],
): Set<number> {
  const ids = new Set<number>();
  for (const d of devolucoes) {
    if (d.order_id != null && d.type === 'returns') ids.add(d.order_id);
  }
  return ids;
}

/** Devoluções que ainda pedem ação do vendedor — o card "Precisa de atenção" do Dashboard.
 *  Ter `acoes_pendentes` NÃO basta: o ML continua devolvendo `available_actions` (ex.:
 *  "return review ok", com prazo) em claim já **fechado e reembolsado**, e o card ficava
 *  anunciando devolução aberta para uma devolução que o ML já tinha finalizado. Exigir
 *  `status === 'opened'` é o mesmo critério que a aba Devoluções usa na pill Aberta/Fechada. */
export function devolucoesAbertas(devolucoes: Devolucao[]): number {
  return devolucoes.filter((d) => d.status === 'opened' && (d.acoes_pendentes?.length ?? 0) > 0).length;
}

/** Devoluções concluídas dentro da janela, para o discreto do card de Faturamento bruto.
 *
 *  Critério de "concluída" (glossário, conferido 1:1 com a API do ML em 2026-07-31): `returns`
 *  com `return_status_money = 'refunded'`. `status !== 'opened'` sozinho não basta — claim pode
 *  fechar com o dinheiro retido.
 *
 *  A JANELA usa `fechado_em` (quando o dinheiro saiu), não `aberto_em`. Filtrar pela abertura
 *  jogava a devolução no mês em que o comprador reclamou, não no mês em que o estorno bateu:
 *  o claim 5552400113 abriu 31/07 e só foi reembolsado (R$ 70,50) em 03/08 — sumia de agosto,
 *  o mês que perdeu o dinheiro. Fallback para `aberto_em` só cobre linha antiga sem backfill.
 *
 *  Não espelha o painel "Devoluções" do ML de propósito: aquela tela lista pela CHEGADA do
 *  pacote e, como diz o glossário, não mostra de forma confiável claim resolvido por mediador. */
export function devolucoesConcluidasNoPeriodo(
  devolucoes: Devolucao[], desde: string, ate: string,
): { qtd: number; valor: number } {
  // Compara por instante, não por string: o PostgREST devolve `fechado_em` como '…+00:00' e a
  // janela vem de toISOString() ('…Z') — lexicograficamente '+' < '.' < 'Z', então strings de
  // mesmo segundo cairiam do lado errado da borda.
  const de = Date.parse(desde);
  const ateMs = Date.parse(ate);
  const concluidas = devolucoes.filter((d) => {
    if (d.type !== 'returns' || d.return_status_money !== 'refunded') return false;
    const quando = dataNoPeriodo(d);
    if (quando == null) return false;
    const t = Date.parse(quando);
    return Number.isFinite(t) && t >= de && t <= ateMs;
  });
  return {
    qtd: concluidas.length,
    valor: concluidas.reduce((s, d) => s + (d.valor_estornado ?? 0), 0),
  };
}

const TIPO_LABEL: Record<string, string> = {
  returns: 'Devolução', // API do ML manda 'returns' (plural) — 'return' nunca ocorre
  mediations: 'Mediação',
  cancel_purchase: 'Cancelamento (compra)',
  cancel_sale: 'Cancelamento (venda)',
  ml_case: 'Reclamação',
  fulfillment: 'Fulfillment',
};
export const labelTipoDevolucao = (t: string | null): string => (t ? TIPO_LABEL[t] ?? t : '—');
