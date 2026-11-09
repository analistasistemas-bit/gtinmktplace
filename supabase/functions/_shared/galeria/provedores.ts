import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ModeloGaleria {
  slug: string
  provedor: 'openrouter' | 'higgsfield'
  /** Higgsfield: caminho do POST. */
  endpoint?: string
  maxReferencias: number
  /** Higgsfield: nome do campo de fotos de referência no corpo; null = não medido, o modelo NÃO aceita referência. */
  campoReferencia: string | null
  /** Higgsfield: nome do campo de proporção; null = não medido, não é enviado (o prompt já pede "Vertical 3:4"). */
  campoProporcao: string | null
  /** Parâmetros fixos do modelo, mesclados no corpo. */
  extra: Record<string, unknown>
  /** US$ por imagem. A Higgsfield não devolve custo na resposta: vale esta tabela (medida em 08/11/2026). */
  custoUsd: number
  rotulo: string
}

// ponytail: a medição de 08/11 (~/Desktop/IA/medicao-galeria-2026-11-08/resultados.json) guarda só prompts, preços e
// request_id, não o corpo das chamadas. Só `image_urls` (≤3) e `prompt_extend` do Qwen são fato medido. O campo de
// proporção de ambos e o campo de referência do Grok ficam null (não enviados) até a Task 9 Step 5 (teste real de 1
// imagem) confirmar os nomes. Até lá o Grok não pode receber referência (corpoHF lança).

// Custos: medição de 08/11/2026 (o plano não fixa valor).
// Nano Banana: 0,039 = custo real medido (tabela 0,042).
export const MODELOS_GALERIA: Record<string, ModeloGaleria> = {
  'google/gemini-nano-banana-2.1': {
    slug: 'google/gemini-nano-banana-2.1',
    provedor: 'openrouter',
    maxReferencias: 3,
    campoReferencia: null,
    campoProporcao: null,
    extra: {},
    custoUsd: 0.039,
    rotulo: 'Nano Banana 2.1',
  },
  'xai/grok-imagine-image-2.0': {
    slug: 'xai/grok-imagine-image-2.0',
    provedor: 'higgsfield',
    endpoint: 'xai/grok-imagine-image-2.0',
    maxReferencias: 0, // campo de referência não medido: sem referência até a Task 9 Step 5
    campoReferencia: null,
    campoProporcao: null,
    extra: {},
    custoUsd: 0.06, // preco_tabela_usd da medição de 08/11
    rotulo: 'Grok Imagine 2',
  },
  'alibaba/qwen-image-3/edit': {
    slug: 'alibaba/qwen-image-3/edit',
    provedor: 'higgsfield',
    endpoint: 'alibaba/qwen-image-3/edit',
    maxReferencias: 3, // a API recusa mais de 3 image_urls
    campoReferencia: 'image_urls',
    campoProporcao: null,
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

/** Corpo do POST da Higgsfield: só campos medidos. Referências além do máximo são cortadas; modelo sem campo de
 * referência medido lança se receber referência. */
export function corpoHF(modelo: ModeloGaleria, prompt: string, imageUrls: string[]): Record<string, unknown> {
  const corpo: Record<string, unknown> = { prompt, ...modelo.extra }
  if (imageUrls.length > 0) {
    if (!modelo.campoReferencia) throw new Error(`${modelo.slug}: campo de referência não medido`)
    corpo[modelo.campoReferencia] = imageUrls.slice(0, modelo.maxReferencias)
  }
  if (modelo.campoProporcao) corpo[modelo.campoProporcao] = '3:4'
  return corpo
}
