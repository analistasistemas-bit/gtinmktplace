import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import { escolherCandidatoValido, montarPromptDesempate, SCHEMA_DESEMPATE } from './categoria-llm-core.ts';
import type { CategoriaCandidata } from '../ml/domain-discovery.ts';
import type { InputCategoria } from '../categoria/resolver.ts';

export { escolherCandidatoValido, montarPromptDesempate } from './categoria-llm-core.ts';

// Desempate de categoria por LLM (ADR-0026 / E3). Closed-set: o modelo SÓ escolhe um
// category_id da lista do domain_discovery; fora dela → null (resolver cai no topo).
export async function desempatarCategoriaLLM(
  input: InputCategoria,
  candidatos: CategoriaCandidata[],
): Promise<string | null> {
  if (candidatos.length === 0) return null;
  try {
    const client = openrouterClient();
    const resp = await client.chat.completions.create({
      model: MODELO_COPY,
      messages: [
        { role: 'system', content: 'Você classifica produtos em categorias de marketplace. Responda só com um category_id da lista fornecida.' },
        { role: 'user', content: montarPromptDesempate(input, candidatos) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA_DESEMPATE },
      temperature: 0,
    });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { category_id?: string };
    return escolherCandidatoValido(parsed.category_id, candidatos);
  } catch (e) {
    console.error('desempate LLM de categoria falhou:', e);
    return null;
  }
}
