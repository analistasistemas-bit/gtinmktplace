import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function auditarOperacaoSuporte(
  db: SupabaseClient,
  context: { userId: string; orgId: string; support: null | { requestId: string } },
  target: { type: string; id: string }, result: 'succeeded' | 'failed' | 'denied',
): Promise<void> {
  if (!context.support) return;
  const { error } = await db.from('support_audit_events').insert({
    org_id: context.orgId, support_request_id: context.support.requestId, actor_id: context.userId,
    event: 'operation', target_type: target.type, target_id: target.id, result,
  });
  if (error) throw new Error('falha ao auditar operação de suporte');
}
