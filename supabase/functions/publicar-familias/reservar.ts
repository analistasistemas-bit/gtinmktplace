// Claim de publicação (spec reajuste C2): `familia_reservar_publicacao` aplica os MESMOS filtros do
// antigo `update ... set status='publicando'` (CREATE/UPDATE) sob o lock do produto, e recusa — sem
// tocar a família — o produto com reajuste de preço em massa ativo.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface FamiliaReservada { id: string; lote_id: string; user_id: string; codigo_pai: string }
export interface FamiliaRecusada { familia_id: string; motivo: string }

export async function reservarFamilias(
  admin: SupabaseClient, orgId: string, familiaIds: string[], operacao: 'CREATE' | 'UPDATE',
): Promise<{ reservadas: FamiliaReservada[]; recusadas: FamiliaRecusada[]; error: { message: string } | null }> {
  const { data, error } = await admin.rpc('familia_reservar_publicacao', {
    p_org: orgId, p_familia_ids: familiaIds, p_operacao: operacao,
  });
  if (error) return { reservadas: [], recusadas: [], error };
  const reservadas: FamiliaReservada[] = [];
  const recusadas: FamiliaRecusada[] = [];
  for (const r of (data ?? []) as Array<FamiliaReservada & { motivo: string | null }>) {
    if (r.motivo) recusadas.push({ familia_id: r.id, motivo: r.motivo });
    else reservadas.push({ id: r.id, lote_id: r.lote_id, user_id: r.user_id, codigo_pai: r.codigo_pai });
  }
  return { reservadas, recusadas, error: null };
}

/** Mensagem do 409 quando nada foi enfileirado e houve recusa; `null` = resposta normal. */
export function mensagemTudoRecusado(enfileiradas: number, recusadas: FamiliaRecusada[]): string | null {
  if (enfileiradas > 0 || recusadas.length === 0) return null;
  return [...new Set(recusadas.map((r) => r.motivo))].join('; ');
}
