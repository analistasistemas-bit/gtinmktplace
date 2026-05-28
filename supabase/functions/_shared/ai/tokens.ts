interface PrecoModelo {
  input: number;  // $/1k tokens
  output: number;
}

const PRECOS: Record<string, PrecoModelo> = {
  'openai/gpt-4o-mini': { input: 0.015, output: 0.06 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
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
