import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import { custoCentavos } from './tokens.ts';
import { type InputCopy, SYSTEM, montarUserPrompt, validarTipoProdutoBusca } from './copywriter-prompt.ts';
import { ORDEM_LEITURA, SLOTS_VAZIOS, type SlotTitulo, type TituloSlots } from './titulo-slots.ts';

export type { InputCopy };

export interface OutputCopy {
  /** Slots do título (ADR-0099). A string final sai de posProcessarTitulo, não daqui. */
  titulo_slots: TituloSlots;
  descricao: string;
  tipo_produto_busca: string;
  /**
   * Termos comuns da categoria que o modelo considerou prováveis mas NÃO achou na fonte
   * (ADR-0100). Existe para dar a eles um destino legítimo em vez de serem contrabandeados para
   * dentro de um slot ("HB Nº 2" em `modelo`). Nunca vai para o título — ver MAX_TERMOS_COM_RISCO.
   */
  termos_com_risco: string[];
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
      // ADR-0100 — válvula de escape. Fica AQUI, no nível raiz, e nunca dentro de titulo_slots:
      // PROPRIEDADES_SLOTS é derivado de ORDEM_LEITURA e posProcessarTitulo só recebe
      // TituloSlots, então um campo fora dessa estrutura é estruturalmente incapaz de chegar ao
      // título. Movê-lo para dentro de titulo_slots o tornaria renderizável e reabriria a Causa C.
      termos_com_risco: { type: 'array', items: { type: 'string' } },
    },
    required: ['titulo_slots', 'descricao', 'tipo_produto_busca', 'termos_com_risco'],
    additionalProperties: false,
  },
  strict: true,
} as const;

/**
 * Coage cada slot pra string (IMPORTANT-3): o schema `json_schema strict` declara `type: string`,
 * mas o modelo é escolhido por organização (ADR-0074) e nem todo provider honra o schema à risca
 * — se devolver número ou null num slot, normalizarSlots chama `.trim()` e estoura "trim is not a
 * function". gerarCopy não tem fallback resiliente (ADR-0030): esse TypeError derrubava a família
 * inteira com stack opaco em vez de uma família com aquele slot vazio.
 */
export function coagirSlots(brutos: Partial<Record<SlotTitulo, unknown>> | undefined | null): TituloSlots {
  const out = { ...SLOTS_VAZIOS };
  for (const slot of ORDEM_LEITURA) {
    const v = brutos?.[slot];
    out[slot] = v == null ? '' : String(v);
  }
  return out;
}

/**
 * Teto de termos aceitos (ADR-0100). coagirSlots é limitado por construção — itera uma lista fixa
 * de dez chaves. Um array não é: um modelo que interprete T8 mal pode devolver dezenas de termos,
 * e a lista inteira iria para console.warn a cada família. Dez cobre com folga o caso real
 * (o exemplo canônico da spec tem dois: "HB" e "Escolar").
 */
export const MAX_TERMOS_COM_RISCO = 10;

/**
 * Coage a lista de termos não comprovados (ADR-0100). Tolera qualquer formato de resposta pela
 * mesma razão de coagirSlots (IMPORTANT-3): o modelo é escolhido por organização (ADR-0074) e nem
 * todo provider honra o schema à risca — e gerarCopy não tem fallback resiliente (ADR-0030), então
 * um TypeError aqui derrubaria a família inteira por causa de um campo puramente diagnóstico.
 */
export function coagirTermosComRisco(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  for (const item of bruto) {
    if (typeof item !== 'string') continue;
    const termo = item.trim();
    if (!termo || vistos.has(termo)) continue;
    vistos.add(termo);
    if (vistos.size >= MAX_TERMOS_COM_RISCO) break;
  }
  return [...vistos];
}

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
  let parsed: {
    titulo_slots: Partial<Record<SlotTitulo, unknown>>;
    descricao: string;
    tipo_produto_busca: string;
    termos_com_risco?: unknown;
  };
  try {
    parsed = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`JSON inválido: ${(e as Error).message}`);
  }
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const termosComRisco = coagirTermosComRisco(parsed.termos_com_risco);
  // Diagnóstico pontual, não censo (ADR-0100, Decisão 4): log de edge function tem retenção curta
  // e não é consultável em massa. Medir frequência exigiria persistir, e isso pede migration.
  if (termosComRisco.length > 0) {
    console.warn(`Copy: termos não ancorados recusados (${input.nome}): ${termosComRisco.join(', ')}`);
  }
  return {
    // Coage cada slot pra string e cobre chave ausente com "" (contrato de dez chaves, mesmo
    // que o schema `required` seja desrespeitado ou o valor venha em outro tipo — IMPORTANT-3).
    titulo_slots: coagirSlots(parsed.titulo_slots),
    descricao: parsed.descricao,
    tipo_produto_busca: validarTipoProdutoBusca(parsed.tipo_produto_busca, input.nome, input.descricao_detalhado),
    termos_com_risco: termosComRisco,
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
