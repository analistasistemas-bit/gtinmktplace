interface PrecoModelo {
  input: number;  // $/1k tokens
  output: number;
}

// $/1k tokens (preços reais OpenRouter): gpt-4o-mini $0.15/1M in · $0.60/1M out;
// gpt-4o $2.50/1M in · $10.00/1M out. Antes estavam 100×/1000× inflados (tratados como $/1M).
const PRECOS: Record<string, PrecoModelo> = {
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
};

export interface UsageTokens {
  prompt_tokens: number;
  completion_tokens: number;
}

export function custoCentavos(modelo: string, usage: UsageTokens): number {
  const preco = PRECOS[modelo];
  if (!preco) return 0;
  if (usage.prompt_tokens === 0 && usage.completion_tokens === 0) return 0;
  const dolares =
    (usage.prompt_tokens / 1000) * preco.input +
    (usage.completion_tokens / 1000) * preco.output;
  return Math.ceil(dolares * 100);
}
