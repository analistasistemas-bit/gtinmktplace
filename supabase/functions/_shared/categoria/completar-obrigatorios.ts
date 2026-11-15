// Kit vinculado não passa pela Revisão: herda a ficha da base. Se a categoria passar a exigir atributo
// depois que a base publicou (PRODUCT_CONSERVATION em MLB455708, 15/11), o ML recusa o kit. Aqui a IA
// preenche só os obrigatórios ausentes (lista fechada) do schema ATUAL; o resto da ficha fica intocado.
// Usado na criação (criar-kit-vinculado) e na publicação/Reenviar (publish-familia-ml).
import { atributosFaltantesGenerico, type AtributoML } from './atributos.ts';
import { preencherAtributosClosedSet, type AtributoAlvo, type InputAtributos } from '../ai/atributos-llm-core.ts';
import type { AtributoSchema } from './schema.ts';

export type LlmAtributos = (input: InputAtributos, alvos: AtributoAlvo[]) => Promise<Record<string, string>>;

/** `resolvidos`/`faltam` são NOMES do schema (pt-BR, ex.: "Conservação do produto"). */
export async function completarObrigatorios(
  schema: AtributoSchema[], atributos: AtributoML[], texto: InputAtributos, llm: LlmAtributos,
): Promise<{ atributos: AtributoML[]; resolvidos: string[]; faltam: string[] }> {
  // SALE_FORMAT/UNITS_PER_PACK fora: o kit sempre os grava pelo N (aplicarKitNosAtributos).
  const schemaObrig = schema.filter((s) => s.id !== 'SALE_FORMAT' && s.id !== 'UNITS_PER_PACK');
  const faltantes = atributosFaltantesGenerico(atributos, schemaObrig);
  if (faltantes.length === 0) return { atributos, resolvidos: [], faltam: [] };

  const ids = new Set(schemaObrig.filter((s) => faltantes.includes(s.nome)).map((s) => s.id));
  const preenchidos = await preencherAtributosClosedSet(schema, atributos, texto, llm);
  const completos = [
    ...atributos.filter((a) => !ids.has(a.id)),
    ...preenchidos.filter((a) => ids.has(a.id) && (a.value_id || a.value_name)),
  ];
  const faltam = atributosFaltantesGenerico(completos, schemaObrig);
  return { atributos: completos, resolvidos: faltantes.filter((n) => !faltam.includes(n)), faltam };
}
