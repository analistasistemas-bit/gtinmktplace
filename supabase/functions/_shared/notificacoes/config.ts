import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { CategoriaNotificacao } from './categorias.ts';
import { enviarTelegram } from './telegram.ts';

export interface ConfigTelegram { token: string | null; chatId: string | null; ativo: boolean }

/** Lê as credenciais/flag do Telegram da organização (tabela configuracoes, E7). */
export async function lerConfigTelegram(admin: SupabaseClient, orgId: string): Promise<ConfigTelegram> {
  const { data } = await admin.from('configuracoes')
    .select('telegram_bot_token, telegram_chat_id, telegram_ativo')
    .eq('org_id', orgId).maybeSingle();
  return {
    token: (data?.telegram_bot_token as string | null) ?? null,
    chatId: (data?.telegram_chat_id as string | null) ?? null,
    ativo: Boolean(data?.telegram_ativo),
  };
}

/** Destinatários de uma categoria: profiles ativos da org que assinam a categoria e têm chat_id.
 * O bot (token) é único da org. Retorna vazio se o Telegram da org estiver inativo ou sem token
 * (interruptor-mestre) — nesse caso ninguém recebe, independentemente das assinaturas. */
export async function lerDestinatarios(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao,
): Promise<{ token: string | null; chatIds: string[] }> {
  const cfg = await lerConfigTelegram(admin, orgId);
  if (!cfg.ativo || !cfg.token) return { token: null, chatIds: [] };
  const { data } = await admin.from('profiles')
    .select('telegram_chat_id')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .contains('telegram_categorias', [categoria])
    .not('telegram_chat_id', 'is', null);
  const chatIds = (data ?? [])
    .map((r) => (r.telegram_chat_id as string | null)?.trim())
    .filter((c): c is string => !!c);
  return { token: cfg.token, chatIds };
}

/** Envia `texto` a todos que assinam `categoria` na org. Best-effort; retorna quantos receberam. */
export async function notificarCategoria(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string,
): Promise<number> {
  const { token, chatIds } = await lerDestinatarios(admin, orgId, categoria);
  let enviados = 0;
  for (const chatId of chatIds) {
    if (await enviarTelegram(token, chatId, texto)) enviados += 1;
  }
  return enviados;
}
