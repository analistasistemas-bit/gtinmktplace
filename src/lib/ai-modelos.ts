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
  { slug: 'openai/gpt-4.1-mini', label: 'GPT-4.1-mini (padrão)', precoLabel: '$0,40 / $1,60 por 1M tokens' },
  { slug: 'openai/gpt-4o-mini', label: 'GPT-4o-mini (mais barato)', precoLabel: '$0,15 / $0,60 por 1M tokens' },
];

// Dormente: nenhuma feature consome geração de imagem ainda (ADR-0074).
export const MODELOS_IMAGEM: OpcaoModeloIA[] = [
  { slug: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (Nano Banana)', precoLabel: '$0,30 / $2,50 por 1M tokens' },
  { slug: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview', precoLabel: 'Novo (Preview)' },
];
