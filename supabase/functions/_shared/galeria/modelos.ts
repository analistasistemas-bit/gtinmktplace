// Tabela dos modelos da galeria, sem import Deno/npm: o front (src/lib/__tests__/ai-modelos-galeria.test.ts) importa
// daqui sem o `tsc` do app tropeçar no `jsr:` de provedores.ts.

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
