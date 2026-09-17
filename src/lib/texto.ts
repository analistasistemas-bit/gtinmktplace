/**
 * Normaliza texto para busca insensível a acentos da língua portuguesa e caixa:
 * - Decompõe caracteres acentuados via NFD (ex.: "ã" -> "a" + \u0303)
 * - Remove diacríticos via regex Unicode (\p{Diacritic})
 * - Converte para minúsculas
 * - Remove espaços excedentes nas pontas
 */
export function normalizarParaBusca(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
