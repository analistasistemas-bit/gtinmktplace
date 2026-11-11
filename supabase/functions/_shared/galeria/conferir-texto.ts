// Conferência do texto desenhado na imagem gerada (ADR-0203, item 6): lê por visão todo texto FORA da embalagem do
// produto e compara com o esperado do plano. Só alerta. Erro, timeout ou resposta fora do formato →
// `verificacao_indisponivel` (nunca `[]` por omissão). Custo da Daludi (sem cobrança).
import { openrouterClient } from '../ai/client.ts';
import { MODELO_VISION } from '../ai/modelos.ts';

export type TipoAlertaTexto = 'texto_faltando' | 'texto_extra' | 'verificacao_indisponivel';
export interface AlertaTexto { tipo: TipoAlertaTexto; nota: string }

export const TIMEOUT_LEITURA_MS = 15_000; // geração 100 s + leitura 15 s < lease de 150 s
const indisponivel = (nota: string): AlertaTexto[] => [{ tipo: 'verificacao_indisponivel', nota }];

export const divergente = (a: AlertaTexto[]) => a.some((x) => x.tipo !== 'verificacao_indisponivel');

// minúsculas, pontuação (inclusive "•", ":" e ".") vira espaço, espaços colapsados; ACENTOS MANTIDOS
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Esperado ausente da concatenação dos lidos (por palavras inteiras) → faltando; item lido com alguma palavra que
 * nenhum esperado contém → extra (um alerta por item). O modelo pode quebrar ou juntar blocos, por isso a
 * comparação do "faltando" é contra a concatenação e a do "extra" é por palavra.
 */
export function compararTextos(esperados: string[], lidos: string[]): AlertaTexto[] {
  const juntos = ` ${lidos.map(norm).filter(Boolean).join(' ')} `;
  const alertas: AlertaTexto[] = [];
  for (const e of esperados) {
    const n = norm(e);
    if (n && !juntos.includes(` ${n} `)) alertas.push({ tipo: 'texto_faltando', nota: e });
  }
  const palavras = new Set(esperados.flatMap((e) => norm(e).split(' ')).filter(Boolean));
  for (const l of lidos) {
    const n = norm(l);
    if (n && n.split(' ').some((p) => !palavras.has(p))) alertas.push({ tipo: 'texto_extra', nota: l });
  }
  return alertas;
}

const SISTEMA = `You read the text drawn in a marketing image of a product.
List EVERY piece of text that was drawn into the artwork (headlines, captions, badges, numbers, labels added by the designer).
IGNORE any text printed on the product itself or on its packaging/label (brand name, logo, printed label, barcode).
One array item per visual text block. Transcribe literally, exactly as written, keeping accents, letter case and any misspelling; never correct or translate.
Answer JSON only: {"textos":["<text block>", ...]}; no drawn text → {"textos":[]}.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['textos'],
  properties: { textos: { type: 'array', items: { type: 'string' } } },
};

/** Resposta do chat.completions → textos lidos, ou null se fora do formato. */
function interpretar(resposta: unknown): string[] | null {
  try {
    // deno-lint-ignore no-explicit-any
    const t = JSON.parse(String((resposta as any)?.choices?.[0]?.message?.content ?? '')).textos;
    return Array.isArray(t) && t.every((x) => typeof x === 'string') ? t : null;
  } catch {
    return null;
  }
}

export async function conferirTexto({ imagemUrl, esperados }: { imagemUrl: string; esperados: string[] }): Promise<AlertaTexto[]> {
  try {
    const resp = await openrouterClient().chat.completions.create({
      model: MODELO_VISION,
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: [{ type: 'text', text: 'Read the text drawn in this image.' }, { type: 'image_url', image_url: { url: imagemUrl } }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'textos_imagem', strict: true, schema: SCHEMA } },
      max_tokens: 600,
      temperature: 0,
      // deno-lint-ignore no-explicit-any
    } as any, { maxRetries: 0, signal: AbortSignal.timeout(TIMEOUT_LEITURA_MS) });
    const lidos = interpretar(resp);
    return lidos ? compararTextos(esperados, lidos) : indisponivel('resposta fora do formato');
  } catch (e) {
    return indisponivel((e as Error)?.name === 'TimeoutError' ? 'leitura sem resposta a tempo' : 'leitura indisponível');
  }
}
