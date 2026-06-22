import { supabase } from './supabase';
import type { Janela } from './metricas';

export type OrigemVenda = 'todos' | 'publiai' | 'fora';

export interface VendaItem {
  id: string;
  ml_item_id: string | null;
  variation_id: number | null;
  titulo: string | null;
  codigo: string | null;
  quantity: number;
  unit_price: number;
  sale_fee: number;
  is_publiai: boolean;
}

export interface Venda {
  id: string;
  order_id: number;
  pack_id: number | null;
  status: string;
  status_detail: string | null;
  date_closed: string | null;
  date_created: string | null;
  comprador_nick: string | null;
  total_amount: number;
  paid_amount: number | null;
  sale_fee_total: number;
  frete_vendedor: number | null;
  liquido: number | null;
  currency: string;
  shipping_status: string | null;
  shipping_substatus: string | null;
  tracking_number: string | null;
  is_publiai: boolean;
  tem_devolucao: boolean;
  itens: VendaItem[];
}

/** Lê as vendas do período direto da tabela (RLS por user). Inclui os itens. */
export async function buscarVendas(janela: Janela, origem: OrigemVenda = 'todos'): Promise<Venda[]> {
  // database.types ainda não conhece as tabelas novas; cast localizado.
  let q = (supabase as unknown as { from: (t: string) => any })
    .from('ml_vendas')
    .select('*, itens:ml_vendas_itens(*)')
    .gte('date_closed', janela.desde)
    .lte('date_closed', janela.ate)
    .order('date_closed', { ascending: false });
  if (origem === 'publiai') q = q.eq('is_publiai', true);
  if (origem === 'fora') q = q.eq('is_publiai', false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Venda[];
}

/** Dispara o backfill (botão "Sincronizar") para o próprio usuário. */
export async function sincronizarFaturamento(dias = 90): Promise<{ sincronizados: number }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backfill-faturamento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ dias }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as { sincronizados: number };
}

/** KPIs agregados das vendas exibidas. */
export interface KpisVendas { faturamento: number; pedidos: number; unidades: number; liquido: number; ticket: number }

export function calcularKpis(vendas: Venda[]): KpisVendas {
  let faturamento = 0, liquido = 0, unidades = 0;
  for (const v of vendas) {
    faturamento += v.total_amount;
    liquido += v.liquido ?? 0;
    for (const i of v.itens) unidades += i.quantity;
  }
  const pedidos = vendas.length;
  return {
    faturamento: Math.round(faturamento * 100) / 100,
    liquido: Math.round(liquido * 100) / 100,
    unidades,
    pedidos,
    ticket: pedidos > 0 ? Math.round((faturamento / pedidos) * 100) / 100 : 0,
  };
}
