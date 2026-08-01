// ADR-0097 — varredura de movimentos órfãos do ledger.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Apaga os movimentos da org cujo SKU não existe mais em nenhuma variação viva.
 *
 * CHAMAR SEMPRE DEPOIS DO DELETE DAS FAMÍLIAS COMMITAR (ADR-0097 D-2): as variações
 * morrem por cascade, então antes do delete o conjunto órfão sai vazio.
 *
 * A regra é anti-join, não "os códigos que acabei de apagar" — `excluir-lote` preserva
 * famílias publicadas (ADR-0019 D-1) e o mesmo `codigo_pai` tem várias famílias após
 * ciclos de UPDATE, então o SKU pode sobreviver em outra linha com o histórico dele.
 *
 * A RPC preserva 4 motivos que nascem sem variação por construção (ADR-0097 D-1.1) — entre
 * eles o tombstone `cancelamento_sem_baixa`, que é GUARDA do D-19 e não histórico: varrê-lo
 * deixaria um webhook `paid` re-entregue baixar estoque de um pedido já cancelado.
 *
 * Best-effort de propósito: a exclusão em si já commitou e é o que o operador pediu.
 * Falhar aqui não pode transformar uma exclusão bem-sucedida em erro na tela — o próximo
 * delete varre de novo (a RPC é idempotente por construção).
 */
export async function limparMovimentosOrfaos(
  admin: SupabaseClient, orgId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('limpar_movimentos_orfaos', { p_org: orgId });
  if (error) {
    console.warn('limpar_movimentos_orfaos falhou (segue):', error.message);
    return 0;
  }
  return (data as number | null) ?? 0;
}
