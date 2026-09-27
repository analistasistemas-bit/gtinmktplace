// ADR-0173: fiação fina sobre `worker_pendencias` e `registrar_pendencias_pedido` (Task 1) — fila
// de retry por (org, order_id) dos workers agendados em fan-out. Nenhuma decisão aqui, só liga.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const LOTE_PENDENCIAS = 20;

/** Pendências ativas (descartado_em null) da org com order_id > depoisDe, por order_id (texto),
 *  até `limite`. Lança em erro. */
export async function lerPendencias(
  admin: SupabaseClient, orgId: string, depoisDe: string, limite: number,
): Promise<string[]> {
  const { data, error } = await admin.from('worker_pendencias')
    .select('order_id')
    .eq('org_id', orgId)
    .is('descartado_em', null)
    .gt('order_id', depoisDe)
    .order('order_id', { ascending: true })
    .limit(limite);
  if (error) throw new Error(`ler pendências: ${error.message}`);
  return ((data ?? []) as Array<{ order_id: string }>).map((r) => r.order_id);
}

/** registrar_pendencias_pedido; `inicio` = ISO do começo da tentativa (só o reconciliar passa
 *  `ok`). Devolve descartados. Lança em erro. */
export async function registrarPendencias(
  admin: SupabaseClient, orgId: string, ok: string[], inicio: string, falhas: string[], erro: string | null,
): Promise<number> {
  const { data, error } = await admin.rpc('registrar_pendencias_pedido', {
    p_org: orgId, p_ok: ok, p_inicio: inicio, p_falhas: falhas, p_erro: erro,
  });
  if (error) throw new Error(`registrar pendências: ${error.message}`);
  return (data as Array<{ descartados: number }> | null)?.[0]?.descartados ?? 0;
}

/** Há pendência ativa na org? (decide `parcial` no fim da rodada). Lança em erro. */
export async function temPendenciaAtiva(admin: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await admin.from('worker_pendencias')
    .select('order_id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('descartado_em', null);
  if (error) throw new Error(`ler pendência ativa: ${error.message}`);
  return count ?? 0;
}
