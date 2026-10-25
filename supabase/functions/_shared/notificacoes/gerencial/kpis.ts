// KPIs de venda por janela (ADR-0190 D-2): faturamento/pedidos/ticket agregados no banco pela RPC
// `vendas_kpis_janela`, com as regras de `calcularResumo` (sales-summary.ts) — o Telegram bate com a tela.
// A RPC devolve faturamento e pedidos; o ticket sai aqui com o round2 do motor (em float), porque
// round(numeric, 2) no SQL diverge no meio-centavo (1,13 ÷ 2: motor 0,56, numeric 0,57).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { round2 } from '../../platform-admin/sales-summary.ts';
import type { JanelaIso } from './janelas.ts';

export interface Kpis { faturamento: number; pedidos: number; ticket: number }

/** Lança em erro ou resposta vazia (nunca zera em silêncio). `numeric` chega como string do PostgREST. */
export async function lerKpis(admin: SupabaseClient, orgId: string, j: JanelaIso): Promise<Kpis> {
  const { data, error } = await admin.rpc('vendas_kpis_janela', { p_org: orgId, p_desde: j.desde, p_ate: j.ate });
  if (error) throw new Error(`vendas_kpis_janela: ${error.message}`);
  if (!data) throw new Error('vendas_kpis_janela: resposta vazia');
  const k = data as Record<string, unknown>;
  const faturamento = Number(k.faturamento);
  const pedidos = Number(k.pedidos);
  // Mesma expressão de `calcularResumo` (sales-summary.ts).
  return { faturamento, pedidos, ticket: pedidos > 0 ? round2(faturamento / pedidos) : 0 };
}
