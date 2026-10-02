import { supabase } from './supabase';
import type { ResumoVitrine } from './vitrine';

/** RPC `vitrine_resumo` (ADR-0176): 1 chamada por período, escopada pela org no SQL. */
export async function carregarVitrine(p: { inicio: string; fim: string }): Promise<ResumoVitrine> {
  const { data, error } = await supabase.rpc('vitrine_resumo', { p_inicio: p.inicio, p_fim: p.fim });
  if (error) throw new Error(error.message);
  return data as unknown as ResumoVitrine;
}
