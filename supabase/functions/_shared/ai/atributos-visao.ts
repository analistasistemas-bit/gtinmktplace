import { openrouterClient } from './client.ts';
import { MODELO_VISION } from './modelos.ts';
import { custoCentavos } from './tokens.ts';
import { montarPromptVisao, type AtributoAlvo } from './atributos-llm-core.ts';

/** Chama o modelo de visão com a foto. Resiliente: erro/timeout → {} (atributo segue faltante). */
export async function atributosPorVisaoLLM(
  imagemUrl: string,
  alvos: AtributoAlvo[],
  onCusto?: (centavos: number) => void,
): Promise<Record<string, string>> {
  if (alvos.length === 0) return {};
  try {
    const resp = await openrouterClient().chat.completions.create(
      {
        model: MODELO_VISION,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: montarPromptVisao(alvos) },
            { type: 'image_url', image_url: { url: imagemUrl, detail: 'low' } },
          ],
        }],
        response_format: { type: 'json_object' },
        temperature: 0,
      },
      { signal: AbortSignal.timeout(30_000) },
    );
    if (onCusto && resp.usage) onCusto(custoCentavos(MODELO_VISION, resp.usage));
    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch (e) {
    console.error('atributos por visão falhou:', e);
    return {};
  }
}
