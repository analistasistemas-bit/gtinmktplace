// ADR-0161 (J8/J13) — enquanto uma migração "preço por variação" está em curso, o anúncio não
// aceita alteração.
//
// Duas razões distintas, ambas necessárias:
//
// 1. O ML recusa: "não será possível realizar alterações no item enquanto estiver em processo de
//    migração" — e na janela ANTES de a tag `variations_migration_pending` aparecer, um PUT é aceito
//    com 200 e DESCARTADO (os clones já nasceram do estado anterior). O guard remoto do ADR-0160
//    (`migracaoEmAndamento`, no conector) cobre o que a tag revela; este guard local cobre o que o
//    app já sabe, antes de gastar a chamada.
// 2. Custo de fila: o guard remoto devolve erro RETENTÁVEL (409), então um UPDATE enfileirado
//    queimaria ~10 tentativas de 30 s na fila serial da org (parallelism=1) antes de desistir, e a
//    família terminaria em `erro` com as fotos das cores novas zeradas. Falhar aqui, definitivo e
//    com mensagem própria, é mais barato e mais claro.
//
// Vale para TODAS as ações que escrevem no anúncio: publicar/atualizar, pausar, reativar, remover e
// excluir. Pausar durante a migração é especialmente ruim — o encerramento que o ML faz no fim pode
// colidir com um `paused` nosso.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const CANAL = 'mercado_livre';

export const MENSAGEM_MIGRACAO_EM_CURSO =
  'Este produto está migrando para preço por variação no Mercado Livre. Enquanto isso o anúncio não '
  + 'aceita alterações. Você será avisado pelo sino quando a migração terminar.';

/**
 * Motivo para recusar a ação, ou `null` se pode seguir.
 *
 * Fail-OPEN em erro de consulta: se o banco não responde, não é hora de bloquear publicação — o
 * guard remoto do conector ainda segura o caso real. Bloquear por falha de leitura transformaria
 * uma indisponibilidade momentânea em recusa de trabalho legítimo.
 */
export async function motivoMigracaoPxvEmCurso(
  admin: SupabaseClient,
  orgId: string,
  codigoPai: string,
): Promise<string | null> {
  const { data, error } = await admin.from('anuncios_externos')
    .select('migracao_pxv_status')
    .eq('org_id', orgId).eq('canal', CANAL).eq('codigo_pai', codigoPai).eq('particao', 0)
    .maybeSingle();
  if (error || !data) return null;
  const st = data.migracao_pxv_status as string | null;
  // `erro` NÃO bloqueia: a migração parou e o operador precisa poder agir — inclusive republicar
  // para o app reconciliar pelo caminho do ADR-0105.
  return st === 'solicitada' || st === 'em_andamento' ? MENSAGEM_MIGRACAO_EM_CURSO : null;
}

/** Variante por `ml_item_id`, para as ações que só têm o id do anúncio (pausar/reativar). */
export async function motivoMigracaoPxvPorItem(
  admin: SupabaseClient,
  orgId: string,
  mlItemId: string,
): Promise<string | null> {
  // O item pode ser o ORIGINAL (ainda apontado pela raiz) ou o anterior de uma migração em curso —
  // por isso as duas colunas.
  const { data, error } = await admin.from('anuncios_externos')
    .select('migracao_pxv_status')
    .eq('org_id', orgId).eq('canal', CANAL)
    .or(`item_externo_id.eq.${mlItemId},ml_item_id_anterior.eq.${mlItemId}`)
    .in('migracao_pxv_status', ['solicitada', 'em_andamento'])
    .limit(1);
  if (error) return null;
  return (data ?? []).length > 0 ? MENSAGEM_MIGRACAO_EM_CURSO : null;
}
