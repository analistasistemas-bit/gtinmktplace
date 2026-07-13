import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ponytail: guarda `typeof Deno` — Deno só existe em runtime edge function; sem ela
// o import quebra sob vitest (Node/jsdom, sem global Deno). Em Deno real, comportamento idêntico.
const env = typeof Deno !== 'undefined' ? Deno.env : undefined;

export const MODELO_COPY = env?.get('AI_MODEL_COPY') ?? 'openai/gpt-4o-mini';
export const MODELO_VISION = env?.get('AI_MODEL_VISION') ?? 'openai/gpt-4o';

/**
 * Resolve o modelo de texto efetivo da org (ADR-0074): configuracoes.ai_model_texto
 * quando presente, senão o fallback MODELO_COPY (env var, comportamento pré-existente).
 * Requer client com acesso de leitura a `configuracoes` (service role recomendado);
 * se a RLS negar a leitura, cai silenciosamente para MODELO_COPY.
 * Nunca propaga erro: qualquer falha (RLS, DB, rede) degrada para MODELO_COPY —
 * resolução de modelo não pode ser a causa de uma família travada em processando/publicando.
 */
export async function resolverModeloTexto(admin: SupabaseClient, orgId: string): Promise<string> {
  try {
    const { data } = await admin
      .from('configuracoes')
      .select('ai_model_texto')
      .eq('org_id', orgId)
      .maybeSingle();
    return data?.ai_model_texto ?? MODELO_COPY;
  } catch {
    return MODELO_COPY;
  }
}
