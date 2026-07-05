import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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
