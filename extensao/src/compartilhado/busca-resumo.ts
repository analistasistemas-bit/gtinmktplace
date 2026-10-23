// Resumo, filtros e ordenação da busca no painel (ADR-0189 D-11, Task 22). Tudo sobre os resultados carregados e por
// produto único; nada é presumido (consultor, 22/10): vendidos = soma dos mínimos informados, com cobertura; "sem
// catálogo identificado" não prova "fora do catálogo"; medalhas não entram (o card não mostra o vendedor).
import type { ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import type { CardBusca } from '../leitura/busca';
import { pisoDosVendidos } from './quanto-vende';

export type ResultadoBusca = ResultadoCard;
export type Resultados = Record<string, ResultadoBusca | undefined>;
export type FiltroBusca = 'seus' | 'full' | 'frete' | 'oficiais' | 'patrocinados' | 'catalogo' | 'oferta';
export type OrdemBusca = 'relevancia' | 'vendidos' | 'preco' | 'margem';

const OFERTA = /oferta/i;
const vinculado = (r: ResultadoBusca | undefined) => !!r && r.estado !== 'sem_vinculo';

export function resumoBusca(cards: CardBusca[], resultados: Resultados, ocorrencias: number) {
  const precos = cards.map((c) => c.preco).filter((p): p is number => p !== null);
  // Vendidos por catálogo uma vez só (o card de catálogo mostra o número do produto, não da oferta).
  const porChave = new Map<string, number>();
  let cobertura = 0;
  for (const c of cards) {
    const piso = pisoDosVendidos(c.vendidosTexto);
    if (piso === null) continue;
    cobertura++;
    const k = c.catalogProductId ?? c.itemId;
    porChave.set(k, Math.max(porChave.get(k) ?? 0, piso));
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
    vinculados: cards.filter((c) => vinculado(resultados[c.itemId])).length,
    vendidosMinimos: { soma: [...porChave.values()].reduce((s, n) => s + n, 0), cobertura },
  };
}

const TESTE: Record<FiltroBusca, (c: CardBusca, r: ResultadoBusca | undefined) => boolean> = {
  seus: (_c, r) => vinculado(r),
  full: (c) => !!c.full,
  frete: (c) => !!c.freteGratis,
  oficiais: (c) => !!c.lojaOficial,
  patrocinados: (c) => c.patrocinado,
  catalogo: (c) => !!c.catalogProductId,
  oferta: (c) => c.selos.some((s) => OFERTA.test(s)),
};

/** Filtros combinados (todos precisam valer). */
export function filtrarCards(cards: CardBusca[], resultados: Resultados, filtros: Set<FiltroBusca>): CardBusca[] {
  return cards.filter((c) => [...filtros].every((f) => TESTE[f](c, resultados[c.itemId])));
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
