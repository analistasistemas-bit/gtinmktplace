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

export async function gerarCopy(input: InputCopy): Promise<OutputCopy> {
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
  if (!conteudo) throw new Error('Copywriter: resposta vazia');
  let parsed: { titulo: string; descricao: string };
  try {
    parsed = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`Copywriter: JSON inválido: ${(e as Error).message}`);
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
