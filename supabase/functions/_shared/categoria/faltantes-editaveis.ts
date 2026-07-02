import type { AtributoSchema } from './schema.ts';
import type { AtributoML } from './atributos.ts';

// COLOR/GTIN/EMPTY_GTIN_REASON são resolvidos por variação/publicação; não editáveis aqui.
const IGNORAR = new Set(['GTIN', 'EMPTY_GTIN_REASON', 'COLOR']);
const TAGS_EXCLUIR = new Set(['read_only', 'hidden', 'variation_attribute', 'multivalued']);
const MAX_TEXTO = 60;

export type CampoFaltante = {
  id: string;
  nome: string;
  tipo: 'closed' | 'numero' | 'texto';
  valores: { id: string; nome: string }[];
  unidades?: { id: string; nome: string }[];
};

function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function ehNumerico(a: AtributoSchema): boolean {
  return a.valueType === 'number' || a.valueType === 'number_unit';
}
function tipoDe(a: AtributoSchema): 'closed' | 'numero' | 'texto' {
  if (a.valores.length > 0) return 'closed';
  if (ehNumerico(a)) return 'numero';
  return 'texto';
}

/** Obrigatórios da categoria ainda não preenchidos, com a forma editável (tipo/valores/unidades). */
export function faltantesEditaveis(schema: AtributoSchema[], atributos: AtributoML[]): CampoFaltante[] {
  const presentes = new Set(atributos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) =>
      (a.required || a.conditionalRequired) &&
      !IGNORAR.has(a.id) &&
      !presentes.has(a.id) &&
      !a.tags.some((t) => TAGS_EXCLUIR.has(t)),
    )
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      tipo: tipoDe(a),
      valores: a.valores,
      unidades: a.valueType === 'number_unit' ? a.allowedUnits : undefined,
    }));
}

function validarNumerico(bruto: string, unidades: { id: string; nome: string }[]): string | null {
  const m = bruto.trim().match(/^(\d+(?:[.,]\d+)?)\s*([\p{L}²³"']*)\s*$/u);
  if (!m) return null;
  const num = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  const validas = unidades.filter((x) => x.nome.trim() || x.id.trim());
  if (validas.length > 0) {
    const un = normalizar(m[2]);
    if (!un) return null;
    const u = validas.find((x) => normalizar(x.nome) === un || normalizar(x.id) === un);
    return u ? `${num} ${u.nome}` : null;
  }
  return String(num);
}

/**
 * Valida UM valor digitado/escolhido pelo operador contra o schema. Diferente da IA, aqui o
 * texto-livre não exige constar no nome/descrição (é o humano informando o dado real).
 */
export function validarValorAtributo(schema: AtributoSchema[], atributoId: string, bruto: string): AtributoML | null {
  const a = schema.find((s) => s.id === atributoId);
  if (!a) return null;
  const tipo = tipoDe(a);
  if (tipo === 'closed') {
    const porId = a.valores.find((v) => v.id === String(bruto));
    const porNome = porId ? null : a.valores.find((v) => normalizar(v.nome) === normalizar(String(bruto)));
    const escolhido = porId ?? porNome;
    return escolhido ? { id: a.id, value_id: escolhido.id } : null;
  }
  if (tipo === 'numero') {
    const v = validarNumerico(String(bruto), a.allowedUnits ?? []);
    return v ? { id: a.id, value_name: v } : null;
  }
  const valor = String(bruto).trim();
  if (!valor || valor.length > MAX_TEXTO) return null;
  return { id: a.id, value_name: valor };
}
