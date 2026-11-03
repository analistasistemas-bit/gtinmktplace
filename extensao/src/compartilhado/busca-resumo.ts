// Resumo, filtros e ordenação da busca no painel (ADR-0189 D-11, Task 22). Tudo sobre os resultados carregados e por
// produto único; nada é presumido (consultor, 22/10): vendidos = soma dos mínimos informados, com cobertura; "sem
// catálogo identificado" não prova "fora do catálogo"; medalhas não entram (o card não mostra o vendedor).
import type { MetadadosCardBusca, ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import type { CardBusca } from '../leitura/busca';
import { pisoDosVendidos } from './quanto-vende';
import { volumeMinimoAoPrecoAtual } from './volume-minimo';
import { vistaDoCard, type EstadoEnriquecimento, type Medalha } from './enriquecimento';

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
  // Faixa por aparição: o mesmo item a R$10 (patrocinado) e R$30 (orgânico) entra com os dois preços.
  const precos = cards.flatMap((c) => (c.ocorrencias.length ? c.ocorrencias.map((o) => o.preco) : [c.preco])).filter((p): p is number => p !== null);
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

/** Resumo do enriquecimento (Task 10). Medalha/UF: vendedores ÚNICOS das ofertas exatas dos cards (perfil não carregado
 *  ou medalha ausente = desconhecida). Tipo: cards com oferta exata. Faixas de vendedores: catálogos únicos com leitura
 *  completa; parciais à parte como "≥ N". Tudo com denominador; nada presumido. */
export function resumoEnriquecimento(cards: CardBusca[], e: EstadoEnriquecimento | undefined) {
  const medalhas: Record<Medalha, number> = { platinum: 0, gold: 0, silver: 0, sem: 0 };
  const vendedores = new Set<number>();
  const porUf = new Map<string, number>();
  let medalhaDesconhecida = 0, ufDesconhecida = 0, cardsComCatalogo = 0, cardsSemVendedor = 0;
  const tipos = { classico: 0, premium: 0, desconhecido: 0, exatas: 0 };
  const pendentes = new Set<string>(); // catálogos ainda sem dado nenhum (aguardando, falha, indisponível)
  const catalogos = new Map<string, NonNullable<NonNullable<ReturnType<typeof vistaDoCard>>['ofertas']> | null>();
  for (const c of cards) {
    const v = vistaDoCard(c, e);
    if (!v) continue;
    cardsComCatalogo++;
    if (v.espera) pendentes.add(c.catalogProductId!);
    if (!catalogos.get(c.catalogProductId!)) catalogos.set(c.catalogProductId!, v.ofertas);
    const x = v.exata;
    if (x?.estado !== 'ok') { cardsSemVendedor++; continue; }
    tipos.exatas++;
    if (x.tipo === 'gold_special') tipos.classico++; else if (x.tipo === 'gold_pro') tipos.premium++; else tipos.desconhecido++;
    if (x.sellerId === null) { cardsSemVendedor++; continue; }
    if (vendedores.has(x.sellerId)) continue;
    vendedores.add(x.sellerId);
    const p = v.vendedor?.estado === 'ok' ? v.vendedor : null;
    if (p?.medalha) medalhas[p.medalha]++; else medalhaDesconhecida++;
    if (p?.uf) porUf.set(p.uf, (porUf.get(p.uf) ?? 0) + 1); else ufDesconhecida++;
  }
  const ufsOrdenadas = [...porUf].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const faixas = { ate5: 0, ate10: 0, ate30: 0, acima30: 0, semOfertas: 0, completos: 0, parciais: [] as number[], catalogos: catalogos.size };
  for (const o of catalogos.values()) {
    if (!o) continue;
    const n = o.vendedoresIdentificados;
    if (!o.completa) { faixas.parciais.push(n); continue; }
    faixas.completos++;
    if (n === 0) faixas.semOfertas++; else if (n <= 5) faixas.ate5++; else if (n <= 10) faixas.ate10++; else if (n <= 30) faixas.ate30++; else faixas.acima30++;
  }
  faixas.parciais.sort((a, b) => b - a);
  return {
    cardsComCatalogo,
    /** Catálogos únicos com algum dado já lido (inclusive indisponível) e os que ainda esperam. */
    catalogosLidos: catalogos.size - pendentes.size,
    vendedores: {
      unicos: vendedores.size, medalhas, medalhaDesconhecida,
      ufs: ufsOrdenadas.slice(0, 5), ufOutros: ufsOrdenadas.slice(5).reduce((n, [, k]) => n + k, 0), ufDesconhecida, cardsSemVendedor,
    },
    tipos,
    faixas,
  };
}
