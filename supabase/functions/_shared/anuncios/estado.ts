// E6 (ADR-0061): máquina de estado por canal em anuncios_externos.
// `import type` (erased em runtime) → sem import jsr; vitest carrega a fn pura.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type StatusAnuncioExterno = 'pendente' | 'publicando' | 'publicado' | 'erro';

/** CREATE vs UPDATE por canal = item_externo_id nulo/preenchido (D-E6.3). Puro. */
export function decidirOperacaoCanal(row: { item_externo_id: string | null }): 'CREATE' | 'UPDATE' {
  return row.item_externo_id ? 'UPDATE' : 'CREATE';
}

/** Garante a linha (org, canal, codigo_pai, particao=0) SEM rebaixar estado existente
 *  (ignoreDuplicates: um 'publicado' nunca volta a 'pendente'). */
export async function garantirAnuncioExterno(admin: SupabaseClient, p: {
  orgId: string; userId: string; canal: string; codigoPai: string;
}): Promise<void> {
  await admin.from('anuncios_externos').upsert(
    { org_id: p.orgId, user_id: p.userId, canal: p.canal, codigo_pai: p.codigoPai, particao: 0, status: 'pendente' },
    { onConflict: 'org_id,canal,codigo_pai,particao', ignoreDuplicates: true },
  );
}

/** Claim atômico do job (família, canal): pendente|erro → publicando.
 *  Retorna a operação decidida, ou null se já está publicando/publicado (idempotência de re-entrega). */
export async function claimAnuncioExterno(admin: SupabaseClient, p: {
  orgId: string; canal: string; codigoPai: string;
}): Promise<{ operacao: 'CREATE' | 'UPDATE' } | null> {
  const { data } = await admin.from('anuncios_externos')
    .update({ status: 'publicando' })
    .eq('org_id', p.orgId).eq('canal', p.canal).eq('codigo_pai', p.codigoPai).eq('particao', 0)
    .in('status', ['pendente', 'erro'])
    .select('item_externo_id');
  const linha = (data as Array<{ item_externo_id: string | null }> | null)?.[0];
  if (!linha) return null;
  return { operacao: decidirOperacaoCanal(linha) };
}
