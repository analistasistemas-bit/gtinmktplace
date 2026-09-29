// Dedupe de notificações de faturamento (ADR-0037 workers). Não testado por vitest na parte de
// integração real com Postgres (usa Deno/supabase-js) — a decisão de branch é coberta pelo teste
// com fake client em __tests__/notificacoes-dedupe.test.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Reserva atomicamente o direito de notificar 1x por (org, entidade, chave). A corrida entre
 *  execuções concorrentes do mesmo evento (retry do QStash, fail-open do dedup do ml-webhook) é
 *  decidida pela PK composta de ml_notificacoes_enviadas no Postgres, não pelo app: só quem
 *  efetivamente INSERE a linha deve notificar. `INSERT ... ON CONFLICT DO NOTHING RETURNING`
 *  devolve a linha só para quem inseriu — a colisão não vira mais ERROR 23505 no log do Postgres
 *  (eram ~600–850 por dia de ruído). Erro real falha FECHADO — não notifica, só loga — porque
 *  perder uma notificação pontual é bem menos grave que duplicar mensagem pro comprador, e o dado
 *  (upsert da venda/pergunta/devolução) já foi gravado corretamente antes desta chamada, então
 *  nada de negócio se perde, só o alerta. */
export async function reservarNotificacao(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  entidade: string,
  chave: string,
): Promise<boolean> {
  const { data, error } = await admin.from('ml_notificacoes_enviadas')
    .upsert({ org_id: orgId, user_id: userId, entidade, chave }, { onConflict: 'org_id,entidade,chave', ignoreDuplicates: true })
    .select('chave');
  if (error) {
    if (error.code !== '23505') console.error(`reservarNotificacao(org=${orgId}, ${entidade}:${chave}): ${error.message}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
