import type { AtributoSchema } from '../categoria/schema.ts';
import type { AtributoML } from '../categoria/atributos.ts';

// Partes puras do preenchimento de atributos por IA, testáveis sem rede (ADR-0026 / E4).
// Cobre os atributos que melhoram a nota de qualidade do anúncio (não só os obrigatórios):
//   - closed-set (values[]): a IA escolhe DENTRO da lista da categoria; nunca inventa.
//   - numéricos (number/number_unit): a IA extrai número (+ unidade permitida) só se claro no texto.
// Texto livre (string sem values, ex.: MODEL) fica de fora — risco alto de invenção.

export interface AtributoAlvo {
  id: string;
  nome: string;
  valores: { id: string; nome: string }[];   // closed-set; vazio quando é numérico
  unidades?: { id: string; nome: string }[]; // só p/ number_unit (ex.: cm, m)
}
export interface InputAtributos {
  nome: string;
  descricao?: string;
}

// Resolvidos fora da IA: GTIN/EMPTY_GTIN_REASON por variação na publicação; COLOR é atributo de
// variação (variacoes.cor); UNITS_PER_PACK tem extrator de regex dedicado (preencherUnitsPerPack).
const IGNORAR = new Set(['GTIN', 'EMPTY_GTIN_REASON', 'COLOR', 'UNITS_PER_PACK']);

// Tags que tiram o atributo do escopo da IA no nível do item: read_only/hidden (não editável /
// não conta p/ a nota), variation_attribute (preenchido por variação, ex.: MAIN_COLOR) e
// multivalued (a IA monta um único valor, não lista). Validado no schema real de MLB255054.
const TAGS_EXCLUIR = new Set(['read_only', 'hidden', 'variation_attribute', 'multivalued']);

function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function ehNumerico(a: AtributoSchema): boolean {
  return a.valueType === 'number' || a.valueType === 'number_unit';
}

/**
 * Atributos que a IA deve tentar preencher: closed-set (obrigatórios E opcionais) e numéricos
 * ainda vazios, excluindo os de variação/ocultos/read-only/multivalor. Quanto mais preenchido,
 * melhor a nota de qualidade do anúncio no ML.
 */
export function atributosAlvo(schema: AtributoSchema[], jaPreenchidos: AtributoML[]): AtributoAlvo[] {
  const presentes = new Set(jaPreenchidos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) =>
      !IGNORAR.has(a.id) &&
      !presentes.has(a.id) &&
      !a.tags.some((t) => TAGS_EXCLUIR.has(t)) &&
      (a.valores.length > 0 || ehNumerico(a)),
    )
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      valores: a.valores,
      unidades: a.valueType === 'number_unit' ? a.allowedUnits : undefined,
    }));
}

/** Valida um valor numérico bruto ("2500 cm", "10", "2,5 m"). number_unit exige unidade permitida. */
function validarNumerico(bruto: string, unidades?: { id: string; nome: string }[]): string | null {
  const m = bruto.trim().match(/^(\d+(?:[.,]\d+)?)\s*([\p{L}²³"']*)\s*$/u);
  if (!m) return null;
  const num = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  const unidadesValidas = (unidades ?? []).filter((x) => x.nome.trim() || x.id.trim());
  if (unidadesValidas.length > 0) {
    const un = normalizar(m[2]);
    if (!un) return null; // number_unit sem unidade → omite (a lista pode ter unidade vazia; ignoramos)
    const u = unidadesValidas.find((x) => normalizar(x.nome) === un || normalizar(x.id) === un);
    if (!u) return null; // unidade fora da lista → omite (não chuta unidade)
    return `${num} ${u.nome}`;
  }
  return String(num); // número puro
}

function preencherMedidasObvias(input: InputAtributos, alvos: AtributoAlvo[]): AtributoML[] {
  const alvo = alvos.find((a) => a.id === 'THICKNESS');
  if (!alvo) return [];

  const texto = `${input.nome} ${input.descricao ?? ''}`;
  const m = texto.match(/\b(\d+(?:[.,]\d+)?)\s*(mm|cm)\b/i);
  if (!m) return [];

  // ponytail: cobre bitola/espessura explícita; dimensões ambíguas ficam com IA/operador.
  const valor = validarNumerico(`${m[1]} ${m[2]}`, alvo.unidades);
  return valor ? [{ id: alvo.id, value_name: valor }] : [];
}

/**
 * Valida a resposta da IA. Closed-set: só aceita value_id/value_name que casa com a lista.
 * Numérico: só aceita número (+ unidade permitida). Qualquer coisa fora disso é omitida (nunca inventa).
 */
export function validarRespostaAtributos(
  resp: Record<string, string>,
  alvos: AtributoAlvo[],
): AtributoML[] {
  const out: AtributoML[] = [];
  for (const alvo of alvos) {
    const bruto = resp?.[alvo.id];
    if (bruto == null || bruto === '') continue;
    if (alvo.valores.length > 0) {
      const porId = alvo.valores.find((v) => v.id === String(bruto));
      const porNome = porId ? null : alvo.valores.find((v) => normalizar(v.nome) === normalizar(String(bruto)));
      const escolhido = porId ?? porNome;
      if (escolhido) out.push({ id: alvo.id, value_id: escolhido.id });
    } else {
      const valor = validarNumerico(String(bruto), alvo.unidades);
      if (valor) out.push({ id: alvo.id, value_name: valor });
    }
  }
  return out;
}

/**
 * Preenche por IA os atributos closed-set/numéricos ainda vazios (ADR-0026 / E4). Não chama a IA
 * quando não há alvo. Resiliente: valor inválido ou IA falha → atributo fica faltante (não inventa).
 */
export async function preencherAtributosClosedSet(
  schema: AtributoSchema[],
  base: AtributoML[],
  input: InputAtributos,
  llm: (input: InputAtributos, alvos: AtributoAlvo[]) => Promise<Record<string, string>>,
): Promise<AtributoML[]> {
  const alvos = atributosAlvo(schema, base);
  const obvios = preencherMedidasObvias(input, alvos);
  const baseComObvios = [...base, ...obvios];
  const restantes = atributosAlvo(schema, baseComObvios);
  if (restantes.length === 0) return baseComObvios;
  const resp = await llm(input, restantes).catch(() => ({} as Record<string, string>));
  const preenchidos = validarRespostaAtributos(resp, restantes);
  return [...baseComObvios, ...preenchidos];
}

/** Prompt: para cada atributo, a lista de valores (closed-set) ou o formato numérico esperado. */
export function montarPromptAtributos(input: InputAtributos, alvos: AtributoAlvo[]): string {
  const blocos = alvos.map((a) => {
    if (a.valores.length > 0) {
      const vals = a.valores.slice(0, 60).map((v) => `${v.id} = ${v.nome}`).join('; ');
      return `- ${a.id} (${a.nome}): escolha um → ${vals}`;
    }
    if (a.unidades && a.unidades.length > 0) {
      return `- ${a.id} (${a.nome}): número + unidade (uma de: ${a.unidades.map((u) => u.nome).join(', ')}). Ex.: "10 ${a.unidades[0].nome}".`;
    }
    return `- ${a.id} (${a.nome}): apenas o número.`;
  }).join('\n');
  return [
    `Produto: ${input.nome}`,
    input.descricao ? `Descrição: ${input.descricao}` : '',
    '',
    'Para cada atributo abaixo, informe o valor que melhor descreve o produto, SOMENTE se a informação',
    'estiver clara no título/descrição. Se não souber, NÃO inclua o atributo. Nunca invente.',
    '',
    blocos,
    '',
    'Responda um JSON { "ATRIBUTO_ID": "valor", ... } só com os que tiver certeza',
    '(value_id para listas; número com unidade para medidas).',
  ].filter(Boolean).join('\n');
}
