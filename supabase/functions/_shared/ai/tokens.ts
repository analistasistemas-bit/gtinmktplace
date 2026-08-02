interface PrecoModelo {
  input: number;  // $/1k tokens
  output: number;
}

// $/1k tokens (preços reais OpenRouter): gpt-4o-mini $0.15/1M in · $0.60/1M out;
// gpt-4o $2.50/1M in · $10.00/1M out. Antes estavam 100×/1000× inflados (tratados como $/1M).
const PRECOS: Record<string, PrecoModelo> = {
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  // DeepSeek V4 Flash 0731 (ADR-0074): $0.09/1M in · $0.18/1M out.
  'deepseek/deepseek-v4-flash-0731': { input: 0.00009, output: 0.00018 },
  // GPT-4.1-mini: $0.40/1M in · $1.60/1M out. Entra na tabela porque o experimento do
  // ADR-0098 o mediu como o melhor em ancoragem e variedade — sem ele aqui, uma org que o
  // selecionasse teria toda a família contabilizada com custo zero (custoCentavos loga
  // warning e devolve 0 para modelo fora da tabela).
  'openai/gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
};

export interface UsageTokens {
  prompt_tokens: number;
  completion_tokens: number;
}

export function custoCentavos(modelo: string, usage: UsageTokens): number {
  const preco = PRECOS[modelo];
  if (!preco) {
    console.warn(`custoCentavos: modelo "${modelo}" fora da tabela PRECOS — custo de IA contabilizado como 0`);
    return 0;
  }
  if (usage.prompt_tokens === 0 && usage.completion_tokens === 0) return 0;
  const dolares =
    (usage.prompt_tokens / 1000) * preco.input +
    (usage.completion_tokens / 1000) * preco.output;
  // toFixed(6) remove ruído de ponto flutuante (ex.: 0.00009*1000 = 0.09000000000000001)
  // antes do ceil, sem perder centavos fracionários reais (ordem de grandeza muito maior).
  return Math.ceil(Number((dolares * 100).toFixed(6)));
}
