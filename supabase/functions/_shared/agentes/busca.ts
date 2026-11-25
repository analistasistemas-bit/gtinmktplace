// Acesso de agentes (ADR-0210, emenda 4): texto livre → candidatos, por palavras. Puro: tudo que chega já é anúncio
// publicado da organização da conexão (`buscarPorTitulo` em deps-banco.ts). Nunca resolve sozinho: só lista.

/** Anúncio publicado: `textos` são os nomes e títulos conhecidos do código pai; `titulo` é o exibido. */
export type AnuncioBusca = { codigo_pai: string; titulo: string; textos: string[]; mlbs: string[] };
export type VariacaoBusca = {
  codigo_pai: string; sku: string; mlb: string; nome: string | null; cor: string | null; tamanho: string | null;
};
export type VariacaoAchada = { sku: string; cor: string | null; tamanho: string | null; mlb: string };
/** `variacoes` só vem quando cor ou tamanho fizeram o candidato aparecer; aí `mlbs` traz só os anúncios delas. */
export type Candidato = { codigo_pai: string; titulo: string; mlbs: string[]; variacoes?: VariacaoAchada[] };
/** `lista_cortada`: há mais candidatos, MLBs ou variações do que os devolvidos. */
export type Busca = { candidatos: Candidato[]; lista_cortada: boolean };

const MAX_CANDIDATOS = 10;
/** Teto de anúncios por alvo (`MAX_MLBS_ALVO` de margens.ts). */
const MAX_MLBS = 60;
const MAX_VARIACOES = 20;
const MAX_PALAVRAS = 20;
const ENFEITE = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'em', 'para', 'o', 'a', 'cor', 'tamanho', 'tam', 'estampa', 'est']);

const partes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const forte = (p: string) => p.length >= 3;

/** Palavras da busca. Enfeite sai se sobrar palavra de 3+ caracteres; sem nenhuma (ou com mais de 20), não busca. */
export function palavras(trecho: string): string[] {
  const todas = [...new Set(partes(trecho))];
  if (todas.length > MAX_PALAVRAS) return [];
  const uteis = todas.filter((p) => !ENFEITE.has(p));
  if (uteis.some(forte)) return uteis;
  return todas.some(forte) ? todas : [];
}

/** "pretas" → "pret": gênero e plural de palavra com 5+ letras. ponytail: sem sinônimo nem correção de digitação. */
const raiz = (p: string) => (/^[a-z]{5,}$/.test(p) ? p.replace(/(?:os|as|o|a|s)$/, '') : p);

/** Número e palavra de até 2 letras só casam inteiros, e o tamanho sempre; o resto casa por trecho. */
function casador(textos: (string | null)[], tamanho: string | null = null) {
  const ps = textos.flatMap((t) => (t ? partes(t) : []));
  const inteiras = new Set([...ps, ...(tamanho ? partes(tamanho) : [])]);
  return (p: string) => inteiras.has(p) || (forte(p) && /[a-z]/.test(p) && ps.some((x) => x.includes(raiz(p))));
}

const faltam = (ps: string[], a: AnuncioBusca) => {
  const casa = casador(a.textos);
  return ps.filter((p) => !casa(p));
};

/** Filtro `or` do PostgREST que traz as variações possíveis (a conferência exata é em `montarCandidatos`): a palavra
 *  mais longa que falta em cada título. Curinga no lugar de vogal e "c" porque o banco guarda acento e cedilha. Só
 *  saem [a-z0-9_], então o texto do agente não altera o filtro. `null` = os títulos bastam. */
export function filtroVariacoes(ps: string[], anuncios: AnuncioBusca[]): string | null {
  const chaves = new Set<string>();
  for (const a of anuncios) {
    const f = faltam(ps, a);
    if (f.length) chaves.add(f.reduce((m, p) => (p.length > m.length ? p : m)));
  }
  const filtros = [...chaves].map((p) => raiz(p).replace(/[aeiouc]/g, '_'))
    .flatMap((p) => ['cor', 'nome', 'tamanho'].map((c) => `${c}.ilike.%${p}%`));
  return filtros.length ? filtros.join(',') : null;
}

/** Variações de um anúncio em que casam todas as palavras que faltam no título; a que casa mais palavras primeiro. */
const doAnuncio = (ps: string[], f: string[], vs: VariacaoBusca[]) => vs
  .map((v) => ({ v, casa: casador([v.nome, v.cor], v.tamanho) }))
  .filter(({ casa }) => f.every(casa))
  .map(({ v, casa }) => ({ v, n: ps.filter(casa).length }))
  .sort((x, y) => y.n - x.n)
  .map(({ v }) => v);

function agrupar(variacoes: VariacaoBusca[]): Map<string, VariacaoBusca[]> {
  const m = new Map<string, VariacaoBusca[]>();
  for (const v of variacoes) {
    const vs = m.get(v.codigo_pai);
    if (vs) vs.push(v);
    else m.set(v.codigo_pai, [v]);
  }
  return m;
}

/** Variações que fariam algum anúncio aparecer, sem corte. */
export function variacoesQueCasam(ps: string[], anuncios: AnuncioBusca[], variacoes: VariacaoBusca[]): VariacaoBusca[] {
  const porCodigo = agrupar(variacoes);
  return anuncios.flatMap((a) => {
    const f = faltam(ps, a);
    return f.length ? doAnuncio(ps, f, porCodigo.get(a.codigo_pai) ?? []) : [];
  });
}

/** Todas as palavras precisam casar: no título, ou o que faltar nele numa MESMA variação (nome, cor ou tamanho). */
export function montarCandidatos(ps: string[], anuncios: AnuncioBusca[], variacoes: VariacaoBusca[]): Busca {
  const achados: Candidato[] = [];
  let lista_cortada = false;
  if (!ps.length) return { candidatos: achados, lista_cortada };
  const porCodigo = agrupar(variacoes);
  for (const a of anuncios) {
    const f = faltam(ps, a);
    const vs = f.length ? doAnuncio(ps, f, porCodigo.get(a.codigo_pai) ?? []) : null;
    const mlbs = [...new Set(vs ? vs.map((v) => v.mlb) : a.mlbs)];
    if (!mlbs.length) continue;
    if (achados.length === MAX_CANDIDATOS) {
      lista_cortada = true;
      break;
    }
    if (mlbs.length > MAX_MLBS || (vs && vs.length > MAX_VARIACOES)) lista_cortada = true;
    achados.push({
      codigo_pai: a.codigo_pai, titulo: a.titulo, mlbs: mlbs.slice(0, MAX_MLBS),
      ...(vs ? { variacoes: vs.slice(0, MAX_VARIACOES).map(({ sku, cor, tamanho, mlb }) => ({ sku, cor, tamanho, mlb })) } : {}),
    });
  }
  return { candidatos: achados, lista_cortada };
}
