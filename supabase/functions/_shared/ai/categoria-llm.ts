import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import { custoCentavos } from './tokens.ts';
import { escolherCandidatoValido, montarPromptDesempate, ehAbstencaoDeliberada, SCHEMA_DESEMPATE } from './categoria-llm-core.ts';
import type { CategoriaCandidata } from '../ml/domain-discovery.ts';
import type { InputCategoria } from '../categoria/resolver.ts';

export { escolherCandidatoValido, montarPromptDesempate, ehAbstencaoDeliberada } from './categoria-llm-core.ts';

/**
 * Desempate de categoria por LLM (ADR-0026/E3, endurecido no ADR-0054). Closed-set: o modelo
 * SÓ escolhe um category_id da lista do domain_discovery, nunca inventa. Retorno de 3 estados
 * (achado da revisão adversarial do ADR-0054 — os dois primeiros NÃO podem cair no mesmo catch):
 * - string: category_id escolhido, validado contra o closed-set.
 * - null: abstenção DELIBERADA ("nenhum candidato serve") → resolver trava em manual.
 * - undefined: falha TÉCNICA (rede/timeout/parse/fora do closed-set) → resolver cai no topo
 *   (comportamento resiliente de sempre — nunca travar por instabilidade da API).
 */
export async function desempatarCategoriaLLM(
  input: InputCategoria,
  candidatos: CategoriaCandidata[],
  modelo: string = MODELO_COPY,
  onCusto?: (centavos: number) => void,
): Promise<string | null | undefined> {
  if (candidatos.length === 0) return undefined;
  try {
    const client = openrouterClient();
    const resp = await client.chat.completions.create({
      model: modelo,
      messages: [
        { role: 'system', content: 'Você classifica produtos em categorias de marketplace. Responda só com um category_id da lista fornecida.' },
        { role: 'user', content: montarPromptDesempate(input, candidatos) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA_DESEMPATE },
      temperature: 0,
    });
    if (onCusto && resp.usage) onCusto(custoCentavos(modelo, resp.usage));
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { category_id?: string | null };
    if (ehAbstencaoDeliberada(parsed.category_id)) return null;
    return escolherCandidatoValido(parsed.category_id, candidatos) ?? undefined;
  } catch (e) {
    console.error('desempate LLM de categoria falhou:', e);
    return undefined;
  }
}
