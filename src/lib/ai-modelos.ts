// Lista curada e fechada de modelos de IA disponíveis via OpenRouter (ADR-0074).
// Todo slug de texto aqui precisa ter preço cadastrado em
// supabase/functions/_shared/ai/tokens.ts::PRECOS — senão o custo vira 0 silenciosamente.
export interface OpcaoModeloIA {
  slug: string;
  label: string;
  precoLabel: string;
}

export const MODELOS_TEXTO: OpcaoModeloIA[] = [
  { slug: 'openai/gpt-4o-mini', label: 'GPT-4o-mini (padrão)', precoLabel: '$0,15 / $0,60 por 1M tokens' },
  { slug: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', precoLabel: '$0,09 / $0,18 por 1M tokens' },
];

// Dormente: nenhuma feature consome geração de imagem ainda (ADR-0074).
export const MODELOS_IMAGEM: OpcaoModeloIA[] = [
  { slug: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (Nano Banana)', precoLabel: '$0,30 / $2,50 por 1M tokens' },
];
