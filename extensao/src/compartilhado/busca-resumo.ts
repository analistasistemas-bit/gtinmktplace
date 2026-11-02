// Resumo, filtros e ordenação da busca no painel (ADR-0189 D-11, Task 22). Tudo sobre os resultados carregados e por
// produto único; nada é presumido (consultor, 22/10): vendidos = soma dos mínimos informados, com cobertura; "sem
// catálogo identificado" não prova "fora do catálogo"; medalhas não entram (o card não mostra o vendedor).
import type { MetadadosCardBusca, ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import type { CardBusca } from '../leitura/busca';
import { pisoDosVendidos } from './quanto-vende';
import { volumeMinimoAoPrecoAtual } from './volume-minimo';

export type ResultadoBusca = ResultadoCard;
export type Resultados = Record<string, ResultadoBusca | undefined>;
/** Ausente = ainda não identificado (nunca "não próprio" nem "sem vínculo"). */
export type Metadados = Record<string, MetadadosCardBusca | undefined>;
export type FiltroBusca = 'meus' | 'vinculados' | 'full' | 'frete' | 'oficiais' | 'patrocinados' | 'catalogo' | 'oferta';
export type OrdemBusca = 'relevancia' | 'vendidos' | 'preco' | 'margem';

const OFERTA = /oferta/i;

/** Grupos de vendas (o card de catálogo ou /up/ mostra o número do produto, não da oferta). Chave: catálogo → /up/ → item.
 *  Item sem catálogo herda o do /up/ só se todos os itens com esse /up/ que têm catálogo concordam. /up/ com dois
 *  catálogos é conflito: seus itens saem dos totais (e são contados à parte). */
function agruparVendas(cards: CardBusca[]): { grupos: Map<string, CardBusca[]>; conflitos: number } {
  const catsDoUp = new Map<string, Set<string>>();
  for (const c of cards) {
    if (c.userProductId && c.catalogProductId) catsDoUp.set(c.userProductId, (catsDoUp.get(c.userProductId) ?? new Set()).add(c.catalogProductId));
  }
  const grupos = new Map<string, CardBusca[]>();
  const emConflito = new Set<string>();
  for (const c of cards) {
    const cats = c.userProductId ? catsDoUp.get(c.userProductId) : undefined;
    if (c.identidadeConflitante) { emConflito.add(`i:${c.itemId}`); continue; }
    if (cats && cats.size > 1) { emConflito.add(`u:${c.userProductId}`); continue; }
    const cat = c.catalogProductId ?? (cats ? [...cats][0] : null);
    const k = cat ? `c:${cat}` : c.userProductId ? `u:${c.userProductId}` : `i:${c.itemId}`;
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  return { grupos, conflitos: emConflito.size };
}

export function resumoBusca(cards: CardBusca[], metadados: Metadados, ocorrencias: number) {
  const precos = cards.map((c) => c.preco).filter((p): p is number => p !== null);
  const { grupos, conflitos } = agruparVendas(cards);
  let somaVendidos = 0, coberturaVendidos = 0, somaVolume = 0, coberturaVolume = 0;
  for (const g of grupos.values()) {
    const pisos = g.map((c) => pisoDosVendidos(c.vendidosTexto)).filter((p): p is number => p !== null);
    if (pisos.length) { coberturaVendidos++; somaVendidos += Math.max(...pisos); }
    // Menor contribuição completa (piso e preço da mesma aparição); nunca piso de um card com preço de outro.
    const contribuicoes = g.flatMap((c) => c.ocorrencias.map((o) => volumeMinimoAoPrecoAtual(o.vendidosTexto, o.preco)))
      .filter((v): v is number => v !== null);
    if (contribuicoes.length) { coberturaVolume++; somaVolume += Math.min(...contribuicoes); }
  }
  return {
    ocorrencias,
    produtos: cards.length,
    menorPreco: precos.length ? Math.min(...precos) : null,
    maiorPreco: precos.length ? Math.max(...precos) : null,
    full: cards.filter((c) => c.full).length,
    freteGratis: cards.filter((c) => c.freteGratis).length,
    oficiais: cards.filter((c) => c.lojaOficial).length,
    patrocinados: cards.filter((c) => c.patrocinado).length,
    comOferta: cards.filter((c) => c.selos.some((s) => OFERTA.test(s))).length,
    comCatalogo: cards.filter((c) => c.catalogProductId).length,
    semCatalogo: cards.filter((c) => !c.catalogProductId).length,
    /** Cards com identificação (anúncio próprio e vínculo) já devolvida pelo banco. */
    identificados: cards.filter((c) => metadados[c.itemId]).length,
    meus: cards.filter((c) => metadados[c.itemId]?.proprio === true).length,
    proprioDesconhecido: cards.filter((c) => (metadados[c.itemId]?.proprio ?? null) === null).length,
    /** Identificados cuja verificação de anúncio próprio falhou (null): nunca contam como "não meu". */
    proprioIndisponivel: cards.filter((c) => metadados[c.itemId] && metadados[c.itemId]!.proprio === null).length,
    vinculados: cards.filter((c) => metadados[c.itemId]?.vinculo).length,
    vendidosMinimos: { soma: somaVendidos, cobertura: coberturaVendidos, grupos: grupos.size, conflitos },
    /** Centavos; piso × preço atual, não é faturamento. */
    volumeMinimo: { centavos: somaVolume, cobertura: coberturaVolume, grupos: grupos.size, conflitos },
  };
}

const TESTE: Record<FiltroBusca, (c: CardBusca, m: MetadadosCardBusca | undefined) => boolean> = {
  meus: (_c, m) => m?.proprio === true,
  vinculados: (_c, m) => !!m?.vinculo,
  full: (c) => !!c.full,
  frete: (c) => !!c.freteGratis,
  oficiais: (c) => !!c.lojaOficial,
  patrocinados: (c) => c.patrocinado,
  catalogo: (c) => !!c.catalogProductId,
  oferta: (c) => c.selos.some((s) => OFERTA.test(s)),
};

/** Filtros combinados (todos precisam valer). */
export function filtrarCards(cards: CardBusca[], metadados: Metadados, filtros: Set<FiltroBusca>): CardBusca[] {
  return cards.filter((c) => [...filtros].every((f) => TESTE[f](c, metadados[c.itemId])));
}

/** Margem Clássico em %, só de card analisado com margem disponível. */
export function margemClassico(r: ResultadoBusca | undefined): number | null {
  if (r?.estado !== 'ok' || !r.margem || r.margem.classico.estado !== 'ok') return null;
  const pct = r.margem.classico.valor.margemPct;
  return typeof pct === 'number' && Number.isFinite(pct) ? pct : null;
}

/** Desconhecidos sempre no fim; empate mantém a ordem da busca. */
export function ordenarCards(cards: CardBusca[], resultados: Resultados, ordem: OrdemBusca): CardBusca[] {
  if (ordem === 'relevancia') return cards;
  const valor = (c: CardBusca): number | null =>
    ordem === 'vendidos' ? pisoDosVendidos(c.vendidosTexto) : ordem === 'preco' ? c.preco : margemClassico(resultados[c.itemId]);
  const desc = ordem !== 'preco';
  return cards
    .map((c, i) => ({ c, i, v: valor(c) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      return (desc ? b.v - a.v : a.v - b.v) || a.i - b.i;
    })
    .map((x) => x.c);
}
