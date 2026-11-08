import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ponytail: guarda `typeof Deno` — Deno só existe em runtime edge function; sem ela
// o import quebra sob vitest (Node/jsdom, sem global Deno). Em Deno real, comportamento idêntico.
const env = typeof Deno !== 'undefined' ? Deno.env : undefined;

// Padrão desde 07/11/2026 (emenda ADR-0074): medido contra o gpt-4.1-mini em cosmético, aviamento
// e grade, deu 76 de 76 chamadas de copy sem falha, nome comercial 40 de 40 e menos da metade do
// custo. É mais lento (~17 s por copy, pico de 27 s): ver TIMEOUT_COPY_MS em copywriter.ts.
// A env var vence este default. Conferido em 2026-08-02: AI_MODEL_COPY NÃO existe nos secrets
// do projeto, então produção cai neste valor. Criar esse secret depois passa a mascarar o
// default aqui — se algum dia produção parecer presa num modelo antigo, olhe os secrets antes
// de olhar este arquivo.
export const MODELO_COPY = env?.get('AI_MODEL_COPY') ?? 'openai/gpt-6-luna';
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
