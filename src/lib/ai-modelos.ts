// Lista curada e fechada de modelos de IA disponíveis via OpenRouter (ADR-0074).
// Todo slug de texto aqui precisa ter preço cadastrado em
// supabase/functions/_shared/ai/tokens.ts::PRECOS — senão o custo vira 0 silenciosamente.
export interface OpcaoModeloIA {
  slug: string;
  label: string;
  precoLabel: string;
}

// DeepSeek V4 Flash saiu da lista no ADR-0098: devolvia JSON truncado sob json_schema strict,
// e gerarCopy é a única etapa de IA sem fallback resiliente (ADR-0030) — falha ali derruba a
// família. Slug removido da constraint em migration; nenhuma org o usava.
export const MODELOS_TEXTO: OpcaoModeloIA[] = [
  { slug: 'openai/gpt-6-luna', label: 'GPT-6 Luna (padrão)', precoLabel: '$0,10 / $0,50 por 1M tokens' },
  { slug: 'openai/gpt-4.1-mini', label: 'GPT-4.1-mini (mais rápido)', precoLabel: '$0,40 / $1,60 por 1M tokens' },
  { slug: 'openai/gpt-4o-mini', label: 'GPT-4o-mini', precoLabel: '$0,15 / $0,60 por 1M tokens' },
];

// Geração da foto do kit com variação (ADR-0200, Task 15). O primeiro é o padrão (org sem escolha). Todo slug aqui
// precisa estar no check `configuracoes_ai_model_imagem_check` e em PRECOS (teste em _shared/ai/__tests__/imagem.test.ts).
// Teste de 07/11 (mesmas fotos e pedido): Nano Banana 2.1 manteve a modelagem; o 2.5 Flash Image mudou a peça.
export const MODELOS_IMAGEM: OpcaoModeloIA[] = [
  { slug: 'google/gemini-nano-banana-2.1', label: 'Gemini Nano Banana 2.1 (padrão)', precoLabel: '~US$ 0,041 por imagem' },
  { slug: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (pode alterar a peça)', precoLabel: '~US$ 0,039 por imagem' },
];

// Galeria da cor por IA. Mesmos slugs de `_shared/galeria/modelos.ts::MODELOS_GALERIA` e do check
// `configuracoes_ai_model_galeria_check` (teste em __tests__/ai-modelos-galeria.test.ts). O primeiro é o padrão.
// `indisponivel`: o back-end (resolverModeloGaleria) ignora o modelo e usa o padrão; a UI mostra a opção desligada.
export const MODELOS_GALERIA_UI: (OpcaoModeloIA & { indisponivel?: string })[] = [
  { slug: 'google/gemini-nano-banana-2.1', label: 'Nano Banana 2.1 (padrão)', precoLabel: '~US$ 0,039 por imagem' },
  { slug: 'alibaba/qwen-image-3/edit', label: 'Qwen Image 3 Edit', precoLabel: '~US$ 0,04 por imagem' },
  { slug: 'xai/grok-imagine-image-2.0', label: 'Grok Imagine 2', precoLabel: '~US$ 0,06 por imagem' },
];

// Valor do seletor da galeria: slug desconhecido ou indisponível cai no padrão (como o back-end faz).
export function slugGaleriaExibido(slug: string | null | undefined): string {
  const m = MODELOS_GALERIA_UI.find((o) => o.slug === slug);
  return m && !m.indisponivel ? m.slug : MODELOS_GALERIA_UI[0].slug;
}
