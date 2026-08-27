// Sonar — busca por EAN (ADR-0127 Errata 1): parsers/agregadores puros. Nenhuma chamada de rede
// aqui. Diferente da busca por termo (nicho, vários concorrentes), a busca por EAN é restrita A
// UM produto específico — o lookup oficial do catálogo (`/products/search?product_identifier=`)
// já resolve isso de graça; a Apify entra só quando o operador escolhe pagar por "vendidos", e
// mesmo assim fica restrita aos `item_id` que o lookup oficial confirmou pertencerem a este
// produto (a busca por termo da Apify é livre e pode trazer produtos vizinhos).
import type { OfertaVendedor } from '../concorrencia/tipos.ts';
import type { ItemVendas } from './sonar-vendas.ts';

const EAN_RE = /^\d{8,14}$/; // mesma regra de _shared/pulse/entrada.ts

/** Valida e normaliza (trim) um EAN/GTIN de entrada. null se não bater 8–14 dígitos. */
export function validarEan(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return EAN_RE.test(t) ? t : null;
}

export interface OfertaEan {
  item_id: string | null;
  seller_id: number | null;
  /** nickname do vendedor; `null` quando o perfil não pôde ser lido (a UI cai no id). */
  vendedor_nome: string | null;
  preco: number | null;
  frete_gratis: boolean;
  full: boolean;
  /** null = sem dado (limite de amostra da Apify OU consulta grátis) — NUNCA 0 por ausência. */
  vendidos: number | null;
  /** Ficha de catálogo que originou a oferta (ADR-0136 D-2). */
  product_id: string | null;
  produto_nome: string | null;
}

/** Uma ficha de catálogo já resolvida pelo chamador (I/O). */
export interface FichaEan {
  product_id: string;
  nome: string | null;
  ofertas: OfertaVendedor[];
}

/** Resumo por ficha exposto na resposta (ADR-0136 D-3). */
export interface ResumoFichaEan {
  product_id: string;
  nome: string | null;
  ofertas: number;
}

/**
 * Achata as ofertas de todas as fichas, anotando `product_id`/`produto_nome` de origem (D-2).
 * Dedupe por `item_id`: o mesmo anúncio pode estar vinculado a mais de uma ficha do mesmo EAN
 * (ex.: variações de cor), e contá-lo duas vezes é exatamente o defeito que este ADR corrige.
 * Primeira ocorrência vence (ordem das fichas). Oferta sem `item_id` nunca é deduplicada — não
 * há chave para comparar.
 */
export function montarOfertasEan(
  fichas: FichaEan[],
  itensApify: ItemVendas[] | null,
  nomesVendedores: Record<string, string> = {},
): OfertaEan[] {
  const vendidosPorItemId = new Map<string, number | null>();
  if (itensApify) {
    for (const item of itensApify) {
      if (item.item_id) vendidosPorItemId.set(item.item_id, item.vendidos);
    }
  }
  const vistos = new Set<string>();
  const ofertas: OfertaEan[] = [];
  for (const ficha of fichas) {
    for (const o of ficha.ofertas) {
      if (o.item_id != null) {
        if (vistos.has(o.item_id)) continue;
        vistos.add(o.item_id);
      }
      ofertas.push({
        item_id: o.item_id,
        seller_id: o.seller_id,
        vendedor_nome: o.seller_id != null ? nomesVendedores[String(o.seller_id)] ?? null : null,
        preco: o.preco,
        frete_gratis: o.frete_gratis,
        full: o.full,
        vendidos: o.item_id != null ? vendidosPorItemId.get(o.item_id) ?? null : null,
        product_id: ficha.product_id,
        produto_nome: ficha.nome,
      });
    }
  }
  return ofertas;
}

export interface RespostaEan {
  conectado: true;
  catalogado: true;
  ean: string;
  /** Primeira ficha (comportamento histórico preservado — ADR-0136 D-2). */
  product_id: string;
  nome_produto: string | null;
  descricao_catalogo: string | null;
  /** Categoria do produto — o cliente usa em `calcular-tarifa-ml` para dizer quanto sobra por
   *  venda. `null` quando nenhuma oferta trouxe o campo. */
  categoria_ml_id: string | null;
  /** O que efetivamente foi calculado — pode ser false mesmo com com_vendas pedido, se a Apify
   *  estava indisponível ou o run falhou (ver `vendas_indisponivel`). */
  com_vendas: boolean;
  /** Só presente quando com_vendas foi PEDIDO mas não pôde ser calculado (sem token / run falhou). */
  vendas_indisponivel?: boolean;
  ofertas: OfertaEan[];
  /** Quantas fichas entraram no resultado. */
  fichas_consultadas: number;
  /** Quantas o `/products/search` retornou (pode ser maior, pelo teto de 5). */
  fichas_encontradas: number;
  fichas: ResumoFichaEan[];
  gerado_em: string;
}

/** Monta a resposta 200 "catalogado" a partir das peças já resolvidas pelo chamador (I/O). */
export function montarRespostaEan(params: {
  ean: string;
  fichas: FichaEan[];
  fichasEncontradas: number;
  descricaoCatalogo: string | null;
  categoriaMlId: string | null;
  nomesVendedores: Record<string, string>;
  comVendas: boolean;
  vendasIndisponivel: boolean;
  itensApify: ItemVendas[] | null;
  geradoEm: string;
}): RespostaEan {
  const {
    ean, fichas, fichasEncontradas, descricaoCatalogo, categoriaMlId, nomesVendedores,
    comVendas, vendasIndisponivel, itensApify, geradoEm,
  } = params;
  const ofertas = montarOfertasEan(fichas, itensApify, nomesVendedores);
  // Resumo por ficha derivado das ofertas JÁ DEDUPLICADAS — nunca das listas cruas de cada ficha.
  // Fonte única: se sum(fichas[].ofertas) divergisse de ofertas.length, a tela mostraria dois
  // números que se contradizem (o defeito que este ADR existe para corrigir).
  const contagemPorFicha = new Map<string, number>();
  for (const o of ofertas) {
    if (o.product_id == null) continue;
    contagemPorFicha.set(o.product_id, (contagemPorFicha.get(o.product_id) ?? 0) + 1);
  }
  const resumoFichas: ResumoFichaEan[] = fichas.map((f) => ({
    product_id: f.product_id,
    nome: f.nome,
    ofertas: contagemPorFicha.get(f.product_id) ?? 0,
  }));
  return {
    conectado: true,
    catalogado: true,
    ean,
    product_id: fichas[0].product_id,
    nome_produto: fichas[0].nome,
    descricao_catalogo: descricaoCatalogo,
    categoria_ml_id: categoriaMlId,
    com_vendas: comVendas,
    ...(vendasIndisponivel ? { vendas_indisponivel: true } : {}),
    ofertas,
    fichas_consultadas: fichas.length,
    fichas_encontradas: fichasEncontradas,
    fichas: resumoFichas,
    gerado_em: geradoEm,
  };
}
