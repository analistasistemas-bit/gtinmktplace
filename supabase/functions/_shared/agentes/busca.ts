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
const ENFEITE = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'em', 'para', 'o', 'a', 'cor', 'estampa', 'est']);
/** Marcador de tamanho nunca é procurado: "tamanho 4" é só o tamanho, que sozinho não busca. */
const MARCADOR = new Set(['tamanho', 'tam']);
/** Cara de tamanho por letras (GGG, XXL, EXG, XXXXL): casa inteira, também em nome e título. */
const LETRAS_TAMANHO = /^\d{0,2}(?:p{1,4}|g{1,5}|m|x+[pgsl]{1,3}|e[xg]g*)$/;

const partes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const forte = (p: string) => p.length >= 3 && !LETRAS_TAMANHO.test(p);

/** Palavras da busca. Enfeite sai se sobrar palavra de 3+ caracteres; sem nenhuma, não busca. Acima de 20, as mais longas. */
export function palavras(trecho: string): string[] {
  const todas = [...new Set(partes(trecho))].filter((p) => !MARCADOR.has(p));
  const uteis = todas.filter((p) => !ENFEITE.has(p));
  const ps = uteis.some(forte) ? uteis : todas.some(forte) ? todas : [];
  return ps.length > MAX_PALAVRAS ? [...ps].sort((a, b) => b.length - a.length).slice(0, MAX_PALAVRAS) : ps;
}

/** "pretas" → "pret": gênero e plural de palavra com 5+ letras. ponytail: sem sinônimo nem correção de digitação. */
const raiz = (p: string) => (/^[a-z]{5,}$/.test(p) ? p.replace(/(?:oes|aes|os|as|es|(?<=[aeou])is|ns|o|a|s)$/, '') : p);

/** "botoes" → "botao", "azuis" → "azul", "marrons" → "marrom": igualdade nos dois sentidos, sem alargar a raiz. */
const singular = (p: string) =>
  p.replace(/(?:oes|aes)$/, 'ao').replace(/(?<=[aeou])is$/, 'l').replace(/ns$/, 'm').replace(/s$/, '');

/** Formas a procurar no banco: plural que troca a última letra (azul/azuis, marrom/marrons) vai nas duas; o resto, pela raiz. */
function formas(p: string): string[] {
  if (/[aeou]l$/.test(p)) return [p, p.replace(/l$/, 'is')];
  if (/[aeiou]m$/.test(p)) return [p, p.replace(/m$/, 'ns')];
  return /(?:[aeou]is|[aeiou]ns)$/.test(p) ? [p, singular(p)] : [raiz(p)];
}

/** Palavra com número, de até 2 letras ou com cara de tamanho só casa inteira; o resto casa pelo começo da palavra. */
function casador(textos: (string | null)[]) {
  const ps = textos.flatMap((t) => (t ? partes(t) : []));
  const inteiras = new Set(ps);
  return (p: string) => inteiras.has(p)
    || (forte(p) && /^[a-z]+$/.test(p) && ps.some((x) => x.startsWith(raiz(p)) || singular(x) === singular(p)));
}

const faltam = (ps: string[], a: AnuncioBusca) => {
  const casa = casador(a.textos);
  return ps.filter((p) => !casa(p));
};

/** Filtros `or` do PostgREST que trazem as variações possíveis (a conferência exata é em `montarCandidatos`): por
 *  código, a palavra mais longa que falta no título dele. Curinga no lugar de vogal e "c" porque o banco guarda acento
 *  e cedilha. Só saem [a-z0-9_], então o texto do agente não altera o filtro. Vazio = os títulos bastam. */
export function filtrosVariacoes(ps: string[], anuncios: AnuncioBusca[]): { codigos: string[]; filtro: string }[] {
  const porPalavra = new Map<string, string[]>();
  for (const a of anuncios) {
    const f = faltam(ps, a);
    if (!f.length) continue;
    const chave = f.reduce((m, p) => (p.length > m.length ? p : m));
    porPalavra.set(chave, [...(porPalavra.get(chave) ?? []), a.codigo_pai]);
  }
  return [...porPalavra].map(([p, codigos]) => {
    const padroes = formas(p).map((x) => x.replace(/[aeiouc]/g, '_'));
    return { codigos, filtro: padroes.flatMap((x) => ['cor', 'nome', 'tamanho'].map((c) => `${c}.ilike.%${x}%`)).join(',') };
  });
}

/** Variações de um anúncio em que casam todas as palavras que faltam no título; a que casa mais palavras primeiro. */
const doAnuncio = (ps: string[], f: string[], vs: VariacaoBusca[]) => vs
  .map((v) => ({ v, casa: casador([v.nome, v.cor, v.tamanho]) }))
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
