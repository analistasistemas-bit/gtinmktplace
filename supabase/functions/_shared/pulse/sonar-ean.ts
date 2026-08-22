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
  preco: number | null;
  frete_gratis: boolean;
  full: boolean;
  /** null = sem dado (limite de amostra da Apify OU consulta grátis) — NUNCA 0 por ausência. */
  vendidos: number | null;
}

/**
 * Restringe "vendidos" (Apify, busca livre por termo) aos `item_id` que a lookup OFICIAL do
 * catálogo confirmou pertencerem a este produto (`ofertasOficiais`, de `parseItensProduto`).
 * Item que a Apify trouxe mas não está em `ofertasOficiais` é descartado — nunca aparece aqui.
 * Item oficial sem match na amostra Apify fica com `vendidos: null` (limite de amostra, não
 * falha). `itensApify: null` = não consultado (grátis ou indisponível) → todos `vendidos: null`.
 */
export function montarOfertasEan(
  ofertasOficiais: OfertaVendedor[],
  itensApify: ItemVendas[] | null,
): OfertaEan[] {
  const vendidosPorItemId = new Map<string, number | null>();
  if (itensApify) {
    for (const item of itensApify) {
      if (item.item_id) vendidosPorItemId.set(item.item_id, item.vendidos);
    }
  }
  return ofertasOficiais.map((o) => ({
    item_id: o.item_id,
    seller_id: o.seller_id,
    preco: o.preco,
    frete_gratis: o.frete_gratis,
    full: o.full,
    vendidos: o.item_id != null ? vendidosPorItemId.get(o.item_id) ?? null : null,
  }));
}

export interface RespostaEan {
  conectado: true;
  catalogado: true;
  ean: string;
  product_id: string;
  nome_produto: string | null;
  descricao_catalogo: string | null;
  /** O que efetivamente foi calculado — pode ser false mesmo com com_vendas pedido, se a Apify
   *  estava indisponível ou o run falhou (ver `vendas_indisponivel`). */
  com_vendas: boolean;
  /** Só presente quando com_vendas foi PEDIDO mas não pôde ser calculado (sem token / run falhou). */
  vendas_indisponivel?: boolean;
  ofertas: OfertaEan[];
  gerado_em: string;
}

/** Monta a resposta 200 "catalogado" a partir das peças já resolvidas pelo chamador (I/O). */
export function montarRespostaEan(params: {
  ean: string;
  productId: string;
  nomeProduto: string | null;
  descricaoCatalogo: string | null;
  comVendas: boolean;
  vendasIndisponivel: boolean;
  ofertasOficiais: OfertaVendedor[];
  itensApify: ItemVendas[] | null;
  geradoEm: string;
}): RespostaEan {
  const {
    ean, productId, nomeProduto, descricaoCatalogo, comVendas, vendasIndisponivel,
    ofertasOficiais, itensApify, geradoEm,
  } = params;
  return {
    conectado: true,
    catalogado: true,
    ean,
    product_id: productId,
    nome_produto: nomeProduto,
    descricao_catalogo: descricaoCatalogo,
    com_vendas: comVendas,
    ...(vendasIndisponivel ? { vendas_indisponivel: true } : {}),
    ofertas: montarOfertasEan(ofertasOficiais, itensApify),
    gerado_em: geradoEm,
  };
}
