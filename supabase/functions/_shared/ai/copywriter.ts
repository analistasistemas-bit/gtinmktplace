import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import { custoCentavos } from './tokens.ts';
import { type InputCopy, SYSTEM, montarUserPrompt, validarTipoProdutoBusca } from './copywriter-prompt.ts';
import { ORDEM_LEITURA, SLOTS_VAZIOS, type TituloSlots } from './titulo-slots.ts';

export type { InputCopy };

export interface OutputCopy {
  /** Slots do título (ADR-0099). A string final sai de posProcessarTitulo, não daqui. */
  titulo_slots: TituloSlots;
  descricao: string;
  tipo_produto_busca: string;
  tokens_input: number;
  tokens_output: number;
  custo_centavos: number;
}

// Dez chaves, todas obrigatórias, todas string. Gerado da ORDEM_LEITURA para que schema e tipo
// nunca divirjam — acrescentar um slot lá o traz para cá automaticamente.
const PROPRIEDADES_SLOTS = Object.fromEntries(
  ORDEM_LEITURA.map((slot) => [slot, { type: 'string' }]),
);

export const SCHEMA_COPY = {
  name: 'copy_anuncio',
  schema: {
    type: 'object',
    properties: {
      // O título deixou de ser string no contrato: a IA devolve slots nomeados e a montagem é
      // determinística (titulo-montar.ts). Decompor um título plano de volta em slots por regex
      // seria adivinhação, e era assim que "| DIFERENCIAL" nascia sem ninguém conseguir auditar.
      titulo_slots: {
        type: 'object',
        properties: PROPRIEDADES_SLOTS,
        required: [...ORDEM_LEITURA],
        // Sem isto o modelo improvisa um slot `diferencial`/`beneficio` e a Causa C do ADR-0098
        // volta pela porta do schema.
        additionalProperties: false,
      },
      descricao: { type: 'string' },
      // Substantivo curto do tipo de produto (ex.: "barbante de crochê"), grounded contra
      // nome+descrição em validarTipoProdutoBusca (ADR-0054) — nunca confiado cru.
      tipo_produto_busca: { type: 'string' },
    },
    required: ['titulo_slots', 'descricao', 'tipo_produto_busca'],
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

async function chamarCopy(input: InputCopy, modelo: string): Promise<OutputCopy> {
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: modelo,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: montarUserPrompt(input) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA_COPY },
      temperature: 0.4,
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  const conteudo = resp.choices[0]?.message?.content;
  if (!conteudo) throw new Error('resposta vazia');
  let parsed: { titulo_slots: Partial<TituloSlots>; descricao: string; tipo_produto_busca: string };
  try {
    parsed = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`JSON inválido: ${(e as Error).message}`);
  }
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    // Merge com SLOTS_VAZIOS: mesmo com `required` no schema, um modelo pode devolver a chave
    // ausente. O default garante o contrato de dez chaves para todo consumidor a jusante.
    titulo_slots: { ...SLOTS_VAZIOS, ...parsed.titulo_slots },
    descricao: parsed.descricao,
    tipo_produto_busca: validarTipoProdutoBusca(parsed.tipo_produto_busca, input.nome, input.descricao_detalhado),
    tokens_input: usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    custo_centavos: custoCentavos(modelo, usage),
  };
}

/**
 * Gera título+descrição. É a única etapa de IA SEM fallback resiliente (ADR-0030): se
 * falhar, derruba a família. Por isso ganha 1 retry (lentidão pontual do OpenRouter é o
 * caso comum) e, ao desistir, lança erro ROTULADO com a etapa — não o "signal aborted"
 * genérico que não dizia onde quebrou (lote #41).
 */
export async function gerarCopy(input: InputCopy, modelo: string = MODELO_COPY): Promise<OutputCopy> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      return await chamarCopy(input, modelo);
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
