// Porta de nomeSku (src/lib/vendas-sku.ts) com formatarNomeProduto/normalizarParaBusca
// (+ SIGLAS/CONECTIVOS) de src/lib/texto.ts. Deno não importa src/; o teste garante a paridade.
const CONECTIVOS = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos', 'ao', 'com', 'sem', 'para', 'por', 'p/', 'c/', 's/']);
const SIGLAS = new Set(['PVC', 'LED', 'EVA', 'MDF', 'TNT', 'USB', 'ABS', 'PET', 'RGB', 'UV', 'PP', 'LCD', 'HD']);

function formatarNomeProduto(s: string | null | undefined): string {
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

function normalizarParaBusca(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Nome legível do SKU: a variação costuma se chamar só pela cor; aí vai o nome da família na frente. */
export function nomeSku(l: { codigo: string; titulo: string | null; nomeFamilia: string | null }): string {
  const { titulo: t, nomeFamilia: f } = l;
  const tFmt = formatarNomeProduto(t) || null;
  const fFmt = formatarNomeProduto(f) || null;
  if (!t) return fFmt ?? l.codigo;
  // Família como palavras inteiras dentro do título ("Tapete" não contém a família "PET").
  const palavras = (s: string) => ` ${normalizarParaBusca(s).split(/\s+/).join(' ')} `;
  if (!f || palavras(t).includes(palavras(f))) return tFmt!;
  return `${fFmt} · ${tFmt}`;
}
