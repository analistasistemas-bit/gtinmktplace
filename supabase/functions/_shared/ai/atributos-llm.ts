import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import {
  montarPromptAtributos,
  type AtributoAlvo,
  type InputAtributos,
} from './atributos-llm-core.ts';

export { atributosAlvo, validarRespostaAtributos, montarPromptAtributos, preencherAtributosClosedSet } from './atributos-llm-core.ts';
export type { AtributoAlvo, InputAtributos } from './atributos-llm-core.ts';

/** Chama o LLM p/ escolher value_ids do closed-set. Resiliente: erro → {}. */
export async function desempatarAtributosLLM(
  input: InputAtributos,
  alvos: AtributoAlvo[],
  modelo: string = MODELO_COPY,
): Promise<Record<string, string>> {
  if (alvos.length === 0) return {};
  try {
    const client = openrouterClient();
    const resp = await client.chat.completions.create({
      model: modelo,
      messages: [
        { role: 'system', content: 'Você preenche atributos de produto em marketplace escolhendo SÓ dentro dos valores permitidos. Na dúvida, omita.' },
        { role: 'user', content: montarPromptAtributos(input, alvos) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed as Record<string, string> : {};
  } catch (e) {
    console.error('preenchimento de atributos por IA falhou:', e);
    return {};
  }
}
