// Liveness da integração ML por conexão (ADR-0069). Não testado por vitest via IO real —
// mock do admin (padrão _shared/faturamento/__tests__/mensagens-io.test.ts).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** 1ª falha permanente-auth de uma conexão: marca auth_alerta_em (transição saudável→morto).
 * Retorna `jaAlertado: true` se a conexão JÁ estava marcada (não repete o alerta — anti-spam).
 * `mensagemErro` não é gravada em nenhuma coluna nesta fase (sem lugar estruturado ainda —
 * ver "Out of scope: erro estruturado por código" no plano); existe no parâmetro para o caller
 * já passar o contexto pronto quando essa coluna existir. */
export async function registrarFalhaAuth(
  admin: SupabaseClient, conexaoId: string, mensagemErro: string,
): Promise<{ jaAlertado: boolean }> {
  void mensagemErro;
  const { data } = await admin.from('marketplace_connections')
    .select('auth_alerta_em').eq('id', conexaoId).maybeSingle();
  const jaAlertado = !!data?.auth_alerta_em;
  if (!jaAlertado) {
    await admin.from('marketplace_connections')
      .update({ auth_alerta_em: new Date().toISOString() }).eq('id', conexaoId);
  }
  return { jaAlertado };
}

/** Sync bem-sucedida: registra o horário e RESETA o estado de alerta (permite alertar de novo
 * se a conexão cair outra vez — transição morto→saudável, ADR-0069). */
export async function registrarSyncOk(admin: SupabaseClient, conexaoId: string): Promise<void> {
  await admin.from('marketplace_connections')
    .update({ ultima_sincronizacao_ok_em: new Date().toISOString(), auth_alerta_em: null })
    .eq('id', conexaoId);
}
