import { supabase } from './supabase';
import type { Janela } from './metricas';
import { labelStatusEnvio } from './ml-status';
import { ehFaturavel } from './resumo-vendas';

export type OrigemVenda = 'todos' | 'publiai' | 'fora';

export interface VendaItem {
  id: string;
  ml_item_id: string | null;
  variation_id: number | null;
  titulo: string | null;
  codigo: string | null;
  cor: string | null;
  ean: string | null;
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
  comprador_nome: string | null;
  /** id numérico do comprador no ML (coluna ml_vendas.comprador_id), p/ detectar recompra. */
  comprador_id: number | null;
  /** UF do destinatário do envio (coluna ml_vendas.uf, sem prefixo "BR-"). */
  uf: string | null;
  /** Cidade do destinatário do envio (coluna ml_vendas.cidade). */
  cidade: string | null;
  total_amount: number;
  paid_amount: number | null;
  sale_fee_total: number;
  frete_vendedor: number | null;
  liquido: number | null;
  /** Total estornado nesta venda (Mercado Pago). Coluna ml_vendas.estorno (ADR-0038). */
  estorno: number | null;
  /** money_release_date — quando o ML libera o recebimento. Coluna ml_vendas (ADR-0038). */
  money_release_date: string | null;
  currency: string;
  shipping_id: number | null;
  shipping_status: string | null;
  shipping_substatus: string | null;
  shipping_logistic: string | null;
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
export interface KpisVendas {
  faturamento: number; pedidos: number; unidades: number; liquido: number; ticket: number;
  /** Quantidade de pedidos por status de envio (Pronto p/ envio, Enviado, Entregue, …). */
  porStatusEnvio: Record<string, number>;
}

export function calcularKpis(vendas: Venda[]): KpisVendas {
  // KPIs monetários refletem o "Vendas brutas" do ML: contam vendas faturáveis — pagas E
  // reembolsadas (paid/partially_refunded/refunded), pelo valor bruto, igual à tela de Métricas
  // do ML (ADR-0038). Cancelados aparecem na lista com o status, mas não inflam o faturamento.
  // A quebra por status de envio conta TODOS os pedidos exibidos (operacional, indep. de pgto).
  let faturamento = 0, liquido = 0, unidades = 0, pedidos = 0;
  const porStatusEnvio: Record<string, number> = {};
  for (const v of vendas) {
    const st = labelStatusEnvio(v.shipping_status, v.shipping_substatus).label;
    porStatusEnvio[st] = (porStatusEnvio[st] ?? 0) + 1;
    if (!ehFaturavel(v.status)) continue;
    faturamento += v.total_amount;
    liquido += v.liquido ?? 0;
    for (const i of v.itens) unidades += i.quantity;
    pedidos += 1;
  }
  return {
    porStatusEnvio,
    faturamento: Math.round(faturamento * 100) / 100,
    liquido: Math.round(liquido * 100) / 100,
    unidades,
    pedidos,
    ticket: pedidos > 0 ? Math.round((faturamento / pedidos) * 100) / 100 : 0,
  };
}
