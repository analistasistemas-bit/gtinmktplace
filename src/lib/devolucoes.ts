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
}

/** Lê as devoluções/claims (mais recentes primeiro). RLS por user. */
export async function buscarDevolucoes(): Promise<Devolucao[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => any })
    .from('ml_devolucoes')
    .select('id, claim_id, order_id, stage, status, type, reason_texto, valor_em_jogo, return_status, return_status_money, acoes_pendentes, aberto_em')
    .order('aberto_em', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Devolucao[];
}

const TIPO_LABEL: Record<string, string> = {
  return: 'Devolução',
  mediations: 'Mediação',
  cancel_purchase: 'Cancelamento (compra)',
  cancel_sale: 'Cancelamento (venda)',
};
export const labelTipoDevolucao = (t: string | null): string => (t ? TIPO_LABEL[t] ?? t : '—');
