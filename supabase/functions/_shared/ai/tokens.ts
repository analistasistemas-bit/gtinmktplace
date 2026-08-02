interface PrecoModelo {
  input: number;  // $/1k tokens
  output: number;
}

// $/1k tokens (preços reais OpenRouter): gpt-4o-mini $0.15/1M in · $0.60/1M out;
// gpt-4o $2.50/1M in · $10.00/1M out. Antes estavam 100×/1000× inflados (tratados como $/1M).
const PRECOS: Record<string, PrecoModelo> = {
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  // GPT-4.1-mini (padrão desde o ADR-0098): $0.40/1M in · $1.60/1M out.
  'openai/gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  // DeepSeek V4 Flash saiu da lista (ADR-0098): devolvia JSON truncado sob json_schema
  // strict, e gerarCopy é a única etapa de IA sem fallback resiliente (ADR-0030).
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
