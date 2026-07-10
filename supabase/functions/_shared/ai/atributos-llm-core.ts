import type { AtributoSchema } from '../categoria/schema.ts';
import type { AtributoML } from '../categoria/atributos.ts';

// Partes puras do preenchimento de atributos por IA, testáveis sem rede (ADR-0026 / E4).
// Cobre os atributos que melhoram a nota de qualidade do anúncio (não só os obrigatórios):
//   - closed-set (values[]): a IA escolhe DENTRO da lista da categoria; nunca inventa.
//   - numéricos (number/number_unit): a IA extrai número (+ unidade permitida), só aceito se o
//     número constar no título/descrição — mesma invariante anti-invenção do texto-livre
//     (ADR-0052), fechando a lacuna que deixava a IA "chutar" um número plausível sem lastro no
//     texto (ex.: WEIGHT inventado por não haver peso no texto — lote #30, 2026-07-09).
// Texto livre (string sem values, ex.: MODEL) fica de fora — risco alto de invenção.

export interface AtributoAlvo {
  id: string;
  nome: string;
  tipo: 'closed' | 'numero' | 'texto';        // closed-set / numérico / texto-livre (só obrigatório)
  valores: { id: string; nome: string }[];   // closed-set; vazio quando é numérico/texto
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

function tipoAlvo(a: AtributoSchema): 'closed' | 'numero' | 'texto' {
  // value_type=string é texto-livre no ML: os valores que o acompanham são SUGESTÕES, não uma
  // lista fechada (essa é value_type=list). Tratar como texto-livre (regra de ouro ADR-0052) para
  // aceitar valor extraído da descrição fora das sugestões (ex.: MATERIAL "poliéster" em Pingentes).
  if (a.valueType === 'string') return 'texto';
  if (a.valores.length > 0) return 'closed';
  if (ehNumerico(a)) return 'numero';
  return 'texto';
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
      // ?? [] defende contra schema de shape antigo (sem tags) vindo de cache stale: degrada
      // pra "sem tag de exclusão" em vez de estourar TypeError e derrubar o enriquecimento inteiro.
      !(a.tags ?? []).some((t) => TAGS_EXCLUIR.has(t)) &&
      // closed-set e numéricos (obrig. e opcional) OU texto-livre SÓ quando obrigatório
      (a.valores.length > 0 || ehNumerico(a) ||
        (a.valueType === 'string' && (a.required || a.conditionalRequired))),
    )
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      tipo: tipoAlvo(a),
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

// Texto-livre só é aceito se as PALAVRAS do valor aparecerem, em sequência contígua, no
// nome/descrição do produto — materializa "inferir do texto, nunca inventar" (ADR-0052).
// Casa por token (não substring de caractere) p/ não aceitar fragmento de palavra
// ("and" ⊂ "Bandeirante") nem valor multi-palavra espalhado. Piso de 2 chars descarta
// fragmento trivial; teto evita a IA despejar a frase inteira. Incorreção semântica (uma
// palavra real do texto, mas do atributo errado) não é invenção e fica p/ o prompt + a
// revisão humana barrarem.
const MIN_TEXTO_LIVRE = 2;
const MAX_TEXTO_LIVRE = 60;
function tokens(s: string): string[] {
  return normalizar(s).split(/\s+/).filter(Boolean);
}

// Mesma trava anti-invenção do texto-livre, para número: só aceita se o valor extraído aparecer
// como número no título/descrição (tolerância de ponto flutuante p/ "13,00" == 13).
function numeroConstaNoTexto(num: number, input: InputAtributos): boolean {
  const texto = `${input.nome} ${input.descricao ?? ''}`;
  const nums = [...texto.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => parseFloat(m[0].replace(',', '.')));
  return nums.some((n) => Math.abs(n - num) < 1e-9);
}

function validarTextoLivre(bruto: string, input: InputAtributos): string | null {
  const valor = bruto.trim();
  if (valor.length < MIN_TEXTO_LIVRE || valor.length > MAX_TEXTO_LIVRE) return null;
  const alvo = tokens(valor);
  if (alvo.length === 0) return null;
  const fonte = tokens(`${input.nome} ${input.descricao ?? ''}`);
  for (let i = 0; i + alvo.length <= fonte.length; i++) {
    if (alvo.every((t, j) => fonte[i + j] === t)) return valor;
  }
  return null;
}

/**
 * Valida a resposta da IA. Closed-set: só aceita value_id/value_name que casa com a lista.
 * Numérico: só número (+ unidade permitida) que também conste no texto do produto. Texto-livre:
 * só se constar no texto do produto. Qualquer coisa fora disso é omitida (nunca inventa).
 */
export function validarRespostaAtributos(
  resp: Record<string, string>,
  alvos: AtributoAlvo[],
  input: InputAtributos,
): AtributoML[] {
  const out: AtributoML[] = [];
  for (const alvo of alvos) {
    const bruto = resp?.[alvo.id];
    if (bruto == null || bruto === '') continue;
    if (alvo.tipo === 'closed') {
      const porId = alvo.valores.find((v) => v.id === String(bruto));
      const porNome = porId ? null : alvo.valores.find((v) => normalizar(v.nome) === normalizar(String(bruto)));
      const escolhido = porId ?? porNome;
      if (escolhido) out.push({ id: alvo.id, value_id: escolhido.id });
    } else if (alvo.tipo === 'numero') {
      const valor = validarNumerico(String(bruto), alvo.unidades);
      if (valor && numeroConstaNoTexto(parseFloat(valor), input)) out.push({ id: alvo.id, value_name: valor });
    } else {
      const valor = validarTextoLivre(String(bruto), input);
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
  const preenchidos = validarRespostaAtributos(resp, restantes, input);
  return [...baseComObvios, ...preenchidos];
}

/** Prompt: para cada atributo, a lista de valores (closed-set) ou o formato numérico esperado. */
export function montarPromptAtributos(input: InputAtributos, alvos: AtributoAlvo[]): string {
  const blocos = alvos.map((a) => {
    if (a.tipo === 'closed') {
      const vals = a.valores.slice(0, 60).map((v) => `${v.id} = ${v.nome}`).join('; ');
      return `- ${a.id} (${a.nome}): escolha um → ${vals}`;
    }
    if (a.tipo === 'numero') {
      if (a.unidades && a.unidades.length > 0) {
        return `- ${a.id} (${a.nome}): número + unidade (uma de: ${a.unidades.map((u) => u.nome).join(', ')}). Ex.: "10 ${a.unidades[0].nome}".`;
      }
      return `- ${a.id} (${a.nome}): apenas o número.`;
    }
    return `- ${a.id} (${a.nome}): copie exatamente do título/descrição; se não constar lá, omita (não invente).`;
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
