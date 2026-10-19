// C4 (auditoria fiscal 19/10) — recuperação durável do push fiscal, pendurada no worker de
// status (6/6h) junto da reconciliação do semáforo. `fiscal_sincronizado_em` = última tentativa
// CONCLUÍDA (ok ou recusa definitiva); publicada depois disso (ou nunca concluída) = push pendente.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const CARENCIA_MS = 30 * 60 * 1000; // push recém-enfileirado pela publicação ainda está na fila

export async function reenfileirarPushFiscalPendente(
  admin: SupabaseClient, orgId: string,
  enfileirar: (familiaId: string) => Promise<unknown>, agora = new Date(),
): Promise<number> {
  const { data: org, error: orgErr } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', orgId).maybeSingle();
  if (orgErr) throw new Error(`reenfileirarPushFiscalPendente: organizations: ${orgErr.message}`);
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) return 0;

  const { data: familias, error } = await admin.from('familias')
    .select('id, publicado_em, fiscal_sincronizado_em')
    .eq('org_id', orgId).eq('status', 'publicado').not('ml_item_id', 'is', null);
  if (error) throw new Error(`reenfileirarPushFiscalPendente: familias: ${error.message}`);

  const limite = agora.getTime() - CARENCIA_MS;
  const pendentes = ((familias ?? []) as Array<{
    id: string; publicado_em: string | null; fiscal_sincronizado_em: string | null;
  }>).filter((f) => {
    if (!f.publicado_em) return false;
    const pub = new Date(f.publicado_em).getTime();
    if (pub > limite) return false;
    return !f.fiscal_sincronizado_em || new Date(f.fiscal_sincronizado_em).getTime() < pub;
  });

  let n = 0;
  for (const f of pendentes) {
    try { await enfileirar(f.id); n++; }
    catch (e) { console.error(`push fiscal não reenfileirado (${f.id}):`, (e as Error).message); }
  }
  return n;
}
