import type { TipoAviamento } from './detectar.ts';
import type { AtributoSchema } from './schema.ts';

export interface AtributoML {
  id: string;
  value_name?: string;
  value_id?: string;
}

// Marca padrão (fallback do fornecedor) — decisão de negócio do Diego, 2026-06-01.
const MARCA = 'Avil';

// Rótulo humano por tipo de aviamento (espelha CATEGORIAS_MANUAIS do front).
const ROTULO_POR_TIPO: Record<TipoAviamento, string | null> = {
  linha: 'Fios e Cadarços',
  fita: 'Fita de Cetim',
  botao: 'Botões',
  cola: 'Bastões de Cola',
  outro: null,
};

// Categorias-folha reais do ML (validadas via API em 2026-06-01). Ver Adendo do ADR-0009.
const CATEGORIA_POR_TIPO: Record<TipoAviamento, string | null> = {
  linha: 'MLB270273', // Fios e Cadarços de Armarinho
  fita: 'MLB255054',  // Fitas de Cetim
  botao: 'MLB270272', // Botões
  cola: 'MLB277319',  // Bastões de Cola (p/ pistolas elétricas) — validado API ML 2026-06-11
  outro: null,        // operador escolhe na revisão
};

// value_id dos valores fixos de RIBBON_TYPE (categoria fita).
const RIBBON_TYPE: { termo: string; id: string }[] = [
  { termo: 'cetim', id: '22691458' },
  { termo: 'gorgorao', id: '22691455' },
  { termo: 'gorgurao', id: '22691455' },
  { termo: 'organza', id: '22691457' },
  { termo: 'veludo', id: '22691459' },
  { termo: 'renda', id: '21206106' },
  { termo: 'vies', id: '5038983' },
  { termo: 'estampada', id: '22691454' },
];
const RIBBON_TYPE_DEFAULT = '22691456'; // "Fita"

// value_id de IS_DOUBLE_FACE (categoria fita). Default Não: o ML auto-preenche "Sim"
// quando o atributo é omitido, e a maioria dos produtos é face simples. "Sim" só quando
// a DESCRICAO_DETALHADO da planilha indicar dupla face (decisão do Diego, 2026-06-09).
const IS_DOUBLE_FACE_NAO = '242084';
const IS_DOUBLE_FACE_SIM = '242085';

const RE_DUPLA_FACE = /\b(dupla[ -]face|face[ -]dupla|duas faces|dois lados)\b/;

/** Detecta menção a dupla face no texto da planilha (case/acento-insensível). */
export function ehDuplaFace(detalhe?: string): boolean {
  return RE_DUPLA_FACE.test(normalizar(detalhe ?? ''));
}

// value_id de MATERIAL (categoria botão): Acrílico (default) ou Madeira.
const MATERIAL_ACRILICO = '1258137';
const MATERIAL_MADEIRA = '2431881';

// Atributos obrigatórios por categoria (tags required na API ML). COLOR é
// atributo de variação (montado na publicação a partir de variacoes.cor).
const OBRIGATORIOS: Record<TipoAviamento, string[]> = {
  linha: ['BRAND', 'MODEL'],
  fita: ['BRAND', 'RIBBON_TYPE'],
  botao: ['BRAND', 'MATERIAL'],
  cola: ['BRAND', 'MODEL'],
  outro: [],
};

// EMPTY_GTIN_REASON: value_id "O produto não tem código cadastrado" (global no ML BR).
// Usado quando a variação não tem GTIN/EAN real (ex.: GTIN interno 3000*).
export const EMPTY_GTIN_REASON_SEM_CODIGO = '17055160';

// Categorias que expõem o atributo EMPTY_GTIN_REASON (validado via API ML 2026-06-04).
// Botão (MLB270272) NÃO o expõe → sem GTIN o atributo é omitido (GTIN é só conditional_required).
const CATEGORIAS_COM_EMPTY_GTIN_REASON = new Set(['MLB270273', 'MLB255054', 'MLB277319']);

export function categoriaAceitaEmptyGtinReason(categoriaId: string | null): boolean {
  return !!categoriaId && CATEGORIAS_COM_EMPTY_GTIN_REASON.has(categoriaId);
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function categoriaParaTipo(tipo: TipoAviamento): string | null {
  return CATEGORIA_POR_TIPO[tipo];
}

/** Rótulo humano do tipo de aviamento (override). 'outro' → null. */
export function rotuloParaTipo(tipo: TipoAviamento): string | null {
  return ROTULO_POR_TIPO[tipo];
}

// GTIN e EMPTY_GTIN_REASON são resolvidos por variação na publicação (lógica de GTIN
// existente), não no nível da família → não entram na lista de "faltantes" da Revisão.
const FALTANTES_IGNORAR = new Set(['GTIN', 'EMPTY_GTIN_REASON']);

/**
 * Atributos determinísticos universais para uma categoria PREVISTA (sem override): só o
 * que dá para saber sem IA — BRAND (fornecedor) e MODEL (nome). Atributos com closed-set
 * (ex.: VOLTAGE) ficam vazios → o E4 preenche por IA. Só inclui o que o schema expõe.
 */
export function montarAtributosBase(schema: AtributoSchema[], nome: string, marca?: string): AtributoML[] {
  const ids = new Set(schema.map((a) => a.id));
  const attrs: AtributoML[] = [];
  if (ids.has('BRAND')) attrs.push({ id: 'BRAND', value_name: marca?.trim() || MARCA });
  if (ids.has('MODEL')) attrs.push({ id: 'MODEL', value_name: nome });
  return attrs;
}

/**
 * Lista (nomes) dos atributos obrigatórios da categoria ainda NÃO preenchidos, lendo o
 * schema dinâmico da API (ADR-0026). Ignora GTIN/EMPTY_GTIN_REASON (resolvidos na publicação).
 */
export function atributosFaltantesGenerico(temAtributos: AtributoML[], schema: AtributoSchema[]): string[] {
  const presentes = new Set(temAtributos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) => (a.required || a.conditionalRequired) && !FALTANTES_IGNORAR.has(a.id) && !presentes.has(a.id))
    .map((a) => a.nome);
}

// "Unidades por kit" (UNITS_PER_PACK) é atributo NUMÉRICO (sem closed-set), então o
// preenchimento por IA (que só cobre values[]) nunca o resolve. Extraímos a quantidade do
// nome/descrição. Exige um token de unidade após o número (und/un/unidades/peças/pçs) para
// não pegar "100% FERRO" nem medidas ("10 mm", "50 metros"). Texto já normalizado (sem acento/ç).
const RE_UNIDADES = /(\d{1,4})\s*(unidades?|unid|und|un|pecas?|pcs)\b/;

/** Extrai a quantidade por pacote do nome (1ª escolha) ou descrição. null se não houver clara. */
export function extrairUnitsPerPack(nome: string, descricao?: string): number | null {
  for (const texto of [nome, descricao]) {
    const m = normalizar(texto ?? '').match(RE_UNIDADES);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Preenche UNITS_PER_PACK a partir da quantidade no nome/descrição. Só age se a categoria
 * expõe o atributo e ele ainda está vazio; sem quantidade clara, deixa faltante (operador
 * completa). Não interfere na detecção de ficha-kit do catálogo (que lê a ficha do ML, não isto).
 */
export function preencherUnitsPerPack(
  schema: AtributoSchema[],
  atributos: AtributoML[],
  nome: string,
  descricao?: string,
): AtributoML[] {
  const exposto = schema.some((a) => a.id === 'UNITS_PER_PACK');
  const jaTem = atributos.some((a) => a.id === 'UNITS_PER_PACK' && (a.value_name || a.value_id));
  if (!exposto || jaTem) return atributos;
  const n = extrairUnitsPerPack(nome, descricao);
  if (n == null) return atributos;
  return [...atributos, { id: 'UNITS_PER_PACK', value_name: String(n) }];
}

/** Monta os atributos obrigatórios da categoria a partir do nome (ADR-0009). */
export function montarAtributosML(tipo: TipoAviamento, nome: string, marca?: string, detalhe?: string): AtributoML[] {
  const texto = normalizar(nome ?? '');
  const brand = marca?.trim() || MARCA;
  switch (tipo) {
    case 'linha':
    case 'cola':
      return [
        { id: 'BRAND', value_name: brand },
        { id: 'MODEL', value_name: nome },
      ];
    case 'fita': {
      const match = RIBBON_TYPE.find((r) => texto.includes(r.termo));
      return [
        { id: 'BRAND', value_name: brand },
        { id: 'RIBBON_TYPE', value_id: match?.id ?? RIBBON_TYPE_DEFAULT },
        { id: 'IS_DOUBLE_FACE', value_id: ehDuplaFace(detalhe) ? IS_DOUBLE_FACE_SIM : IS_DOUBLE_FACE_NAO },
      ];
    }
    case 'botao':
      return [
        { id: 'BRAND', value_name: brand },
        { id: 'MATERIAL', value_id: texto.includes('madeira') ? MATERIAL_MADEIRA : MATERIAL_ACRILICO },
      ];
    default:
      return [];
  }
}

/** Lista os obrigatórios ausentes (validação pré-publicação). 'outro' → ['CATEGORIA']. */
export function atributosFaltantes(tipo: TipoAviamento, atributos: AtributoML[]): string[] {
  if (categoriaParaTipo(tipo) == null) return ['CATEGORIA'];
  const presentes = new Set(
    atributos.filter((a) => a.value_name || a.value_id).map((a) => a.id),
  );
  return OBRIGATORIOS[tipo].filter((id) => !presentes.has(id));
}
