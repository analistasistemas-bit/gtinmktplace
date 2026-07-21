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
  pack_id?: number | null;
  /** Valor já reembolsado via Mercado Pago (ml_vendas.estorno, ADR-0038) — `valor_em_jogo` vem
   *  sempre null da API de claims do ML, que não traz nenhum campo monetário. */
  valor_estornado?: number | null;
}

/** Lê as devoluções/claims (mais recentes primeiro). RLS por user. */
export async function buscarDevolucoes(): Promise<Devolucao[]> {
  const { data, error } = await supabase
    .from('ml_devolucoes')
    .select('id, claim_id, order_id, stage, status, type, reason_texto, valor_em_jogo, return_status, return_status_money, acoes_pendentes, aberto_em')
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

const TIPO_LABEL: Record<string, string> = {
  return: 'Devolução',
  mediations: 'Mediação',
  cancel_purchase: 'Cancelamento (compra)',
  cancel_sale: 'Cancelamento (venda)',
};
export const labelTipoDevolucao = (t: string | null): string => (t ? TIPO_LABEL[t] ?? t : '—');
