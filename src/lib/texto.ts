/**
 * Normaliza texto para busca insensível a acentos da língua portuguesa e caixa:
 * - Decompõe caracteres acentuados via NFD (ex.: "ã" -> "a" + \u0303)
 * - Remove diacríticos via regex Unicode (\p{Diacritic})
 * - Converte para minúsculas
 * - Remove espaços excedentes nas pontas
 */
const CONECTIVOS = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos', 'ao', 'com', 'sem', 'para', 'por', 'p/', 'c/', 's/']);
// ponytail: lista curta de siglas do catálogo; sigla fora dela vira "Xyz". Ampliar quando aparecer.
const SIGLAS = new Set(['PVC', 'LED', 'EVA', 'MDF', 'TNT', 'USB', 'ABS', 'PET', 'RGB', 'UV', 'PP', 'LCD', 'HD']);

/**
 * Só EXIBIÇÃO: nome de produto todo em maiúsculas (padrão das planilhas de ERP) vira iniciais
 * maiúsculas, com conectivos em minúscula. Nome que já tem minúsculas foi formatado por alguém e
 * fica como está; palavra com número (5CM, C/72UND) também. Nunca usar em input, export ou no que vai ao canal.
 */
export function formatarNomeProduto(s: string | null | undefined): string {
  if (!s) return '';
  if (s !== s.toLocaleUpperCase('pt-BR') || s === s.toLocaleLowerCase('pt-BR')) return s;
  let primeira = true;
  return s.replace(/\S+/g, (w) => {
    const eraPrimeira = primeira; primeira = false;
    if (/\d/.test(w) || SIGLAS.has(w)) return w;
    const min = w.toLocaleLowerCase('pt-BR');
    if (!eraPrimeira && CONECTIVOS.has(min)) return min;
    return min.replace(/(^|-)(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase('pt-BR'));
  });
}

export function normalizarParaBusca(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
