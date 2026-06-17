import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import { custoCentavos } from './tokens.ts';
import { type InputCopy, SYSTEM, montarUserPrompt } from './copywriter-prompt.ts';

export type { InputCopy };

export interface OutputCopy {
  titulo: string;
  descricao: string;
  tokens_input: number;
  tokens_output: number;
  custo_centavos: number;
}

const SCHEMA = {
  name: 'copy_anuncio',
  schema: {
    type: 'object',
    properties: {
      // Sem maxLength: o teto de 60 chars cortava a string mecanicamente no meio da
      // palavra (ex.: "IDEAL PARA P"). O limite agora é aplicado em garantirMetragemTitulo
      // /clampTitulo, que derruba segmentos/palavras inteiras sem cortar (bug lote #26).
      titulo: { type: 'string' },
      descricao: { type: 'string' },
    },
    required: ['titulo', 'descricao'],
    additionalProperties: false,
  },
  strict: true,
} as const;

/** Timeout do OpenRouter foi disparado (AbortSignal) ou o SDK abortou a chamada. */
function foiTimeout(e: unknown): boolean {
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return true;
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes('aborted') || msg.includes('timed out') || msg.includes('timeout');
}

async function chamarCopy(input: InputCopy): Promise<OutputCopy> {
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: MODELO_COPY,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: montarUserPrompt(input) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      temperature: 0.4,
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  const conteudo = resp.choices[0]?.message?.content;
  if (!conteudo) throw new Error('resposta vazia');
  let parsed: { titulo: string; descricao: string };
  try {
    parsed = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`JSON inválido: ${(e as Error).message}`);
  }
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    titulo: parsed.titulo,
    descricao: parsed.descricao,
    tokens_input: usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    custo_centavos: custoCentavos(MODELO_COPY, usage),
  };
}

/**
 * Gera título+descrição. É a única etapa de IA SEM fallback resiliente (ADR-0030): se
 * falhar, derruba a família. Por isso ganha 1 retry (lentidão pontual do OpenRouter é o
 * caso comum) e, ao desistir, lança erro ROTULADO com a etapa — não o "signal aborted"
 * genérico que não dizia onde quebrou (lote #41).
 */
export async function gerarCopy(input: InputCopy): Promise<OutputCopy> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      return await chamarCopy(input);
    } catch (e) {
      ultimoErro = e;
      console.warn(`Copy tentativa ${tentativa}/2 falhou: ${(e as Error).message}`);
    }
  }
  if (foiTimeout(ultimoErro)) {
    throw new Error('Copy (IA/OpenRouter): excedeu 30s (timeout) após 2 tentativas');
  }
  throw new Error(`Copy (IA/OpenRouter): ${ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro)}`);
}
