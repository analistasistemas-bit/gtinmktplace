import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ModeloGaleria {
  slug: string
  provedor: 'openrouter' | 'higgsfield'
  /** Higgsfield: caminho do POST. */
  endpoint?: string
  maxReferencias: number
  /** Parâmetros fixos do modelo, mesclados no corpo. */
  extra: Record<string, unknown>
  /** US$ por imagem. A Higgsfield não devolve custo na resposta: vale esta tabela (medida em 08/11/2026). */
  custoUsd: number
  rotulo: string
}

// ponytail: nome do campo de proporção da Higgsfield NÃO confirmado (nenhuma chamada existente no repo).
// Confirmar contra a API real no Task 9 Step 5 (teste real de 1 imagem) e ajustar só esta constante.
export const CAMPO_PROPORCAO_HF = 'aspect_ratio'

// Custos: medição de 08/11/2026 (o plano não fixa valor).
// maxReferencias de nano banana/grok: sem limite medido; 3 mantém os três modelos com o mesmo contrato.
export const MODELOS_GALERIA: Record<string, ModeloGaleria> = {
  'google/gemini-nano-banana-2.1': {
    slug: 'google/gemini-nano-banana-2.1',
    provedor: 'openrouter',
    maxReferencias: 3,
    extra: {},
    custoUsd: 0.039,
    rotulo: 'Nano Banana 2.1',
  },
  'xai/grok-imagine-image-2.0': {
    slug: 'xai/grok-imagine-image-2.0',
    provedor: 'higgsfield',
    endpoint: 'xai/grok-imagine-image-2.0',
    maxReferencias: 3,
    extra: {},
    custoUsd: 0.04,
    rotulo: 'Grok Imagine 2',
  },
  'alibaba/qwen-image-3/edit': {
    slug: 'alibaba/qwen-image-3/edit',
    provedor: 'higgsfield',
    endpoint: 'alibaba/qwen-image-3/edit',
    maxReferencias: 3, // a API recusa mais de 3 image_urls
    extra: { prompt_extend: true }, // prompt_extend:false é recusado (400)
    custoUsd: 0.04,
    rotulo: 'Qwen Image 3 Edit',
  },
}

export const MODELO_GALERIA_PADRAO = MODELOS_GALERIA['google/gemini-nano-banana-2.1']

export function modeloGaleria(slug: string | null | undefined): ModeloGaleria {
  return (slug && MODELOS_GALERIA[slug]) || MODELO_GALERIA_PADRAO
}

/** configuracoes.ai_model_galeria (coluna criada na Task 5); nulo, desconhecido ou erro → padrão. */
export async function resolverModeloGaleria(admin: SupabaseClient, orgId: string): Promise<ModeloGaleria> {
  try {
    const { data } = await admin
      .from('configuracoes')
      .select('ai_model_galeria')
      .eq('org_id', orgId)
      .maybeSingle()
    return modeloGaleria(data?.ai_model_galeria)
  } catch {
    return MODELO_GALERIA_PADRAO
  }
}

/** Corpo do POST da Higgsfield: 3:4, referências limitadas ao máximo do modelo e parâmetros fixos. */
export function corpoHF(modelo: ModeloGaleria, prompt: string, imageUrls: string[]): Record<string, any> {
  return {
    prompt,
    image_urls: imageUrls.slice(0, modelo.maxReferencias),
    [CAMPO_PROPORCAO_HF]: '3:4',
    ...modelo.extra,
  }
}
