// Cruzamento ficha↔anúncio do Sonar (ADR-0125/D4): funções puras, sem chamada de rede. As duas
// edges continuam desacopladas (ADR-0122) — `pulse-sonar` expõe `item_ids` por ficha,
// `pulse-sonar-vendas` expõe `por_anuncio` chaveado por item_id; o cruzamento vive só aqui.
import type { ItemVendasSonar } from './sonar';

export interface VendasFicha {
  vendidos: number | null;
  faturamento: number | null;
  avaliacao_nota: number | null;
  avaliacao_qtd: number | null;
  preco_anterior: number | null;
  desconto_pct: number | null;
  selo: string | null;
  posicao_organica: number | null;
  patrocinado: boolean | null;
  full: boolean | null;
  flex: boolean | null;
  internacional: boolean | null;
  anuncios_casados: number;
}

/** true se algum candidato for true; false se nenhum true mas algum não-null; null se todos null
 *  (D6: ausência nunca vira false/0 disfarçado). */
function algumOuNull(
  candidatos: ItemVendasSonar[],
  campo: 'patrocinado' | 'full' | 'flex' | 'internacional',
): boolean | null {
  let visto = false;
  for (const c of candidatos) {
    const v = c[campo];
    if (v === true) return true;
    if (v === false) visto = true;
  }
  return visto ? false : null;
}

/**
 * Casamento primário (D4): `idPublicacao` (item_id) ∈ `ficha.item_ids`. Atalho: `catalog_product_id`
 * do anúncio === `product_id` da ficha (quando o anúncio está em catálogo). Sem candidato → null.
 *
 * Anúncio principal (D1): maior `vendidos`; empate ou ambos null → menor `posicao`; empate total
 * → primeiro candidato (ordem de relevância da busca, mesma convenção de `indexarPorAnuncio` e do
 * `produto_destaque` em sonar-vendas.ts). Faturamento/avaliação/desconto/selo vêm todos do MESMO
 * anúncio principal — nunca colados de anúncios diferentes.
 */
export function cruzarFichaComVendas(
  ficha: { product_id: string; item_ids?: string[] },
  porAnuncio: Record<string, ItemVendasSonar> | undefined,
): VendasFicha | null {
  if (!porAnuncio) return null; // cache v4 antigo (D2): campo aditivo pode não existir ainda
  const itemIds = new Set(ficha.item_ids ?? []);
  const candidatos = Object.values(porAnuncio).filter(
    (it) =>
      (it.item_id != null && itemIds.has(it.item_id)) ||
      (it.catalog_product_id != null && it.catalog_product_id === ficha.product_id),
  );
  if (candidatos.length === 0) return null;

  let principal = candidatos[0];
  for (const c of candidatos.slice(1)) {
    const cVendidos = c.vendidos ?? -1;
    const pVendidos = principal.vendidos ?? -1;
    if (cVendidos > pVendidos) { principal = c; continue; }
    if (cVendidos < pVendidos) continue;
    const cPosicao = c.posicao ?? Infinity;
    const pPosicao = principal.posicao ?? Infinity;
    if (cPosicao < pPosicao) principal = c;
  }

  const vendidos = principal.vendidos; // = maior entre os com dado (D1); todos null → null
  let posicaoOrganica: number | null = null;
  for (const c of candidatos) {
    if (c.patrocinado !== false || c.posicao == null) continue; // null (desconhecido) NÃO é orgânico
    if (posicaoOrganica == null || c.posicao < posicaoOrganica) posicaoOrganica = c.posicao;
  }

  return {
    vendidos,
    faturamento: vendidos != null && principal.preco != null ? vendidos * principal.preco : null,
    avaliacao_nota: principal.avaliacao_nota,
    avaliacao_qtd: principal.avaliacao_qtd,
    preco_anterior: principal.preco_anterior,
    desconto_pct: principal.desconto_pct,
    selo: principal.selo,
    posicao_organica: posicaoOrganica,
    patrocinado: algumOuNull(candidatos, 'patrocinado'),
    full: algumOuNull(candidatos, 'full'),
    flex: algumOuNull(candidatos, 'flex'),
    internacional: algumOuNull(candidatos, 'internacional'),
    anuncios_casados: candidatos.length,
  };
}

/** Espalhamento de preço da ficha: (max-min)/min×100. min≤0 ou sem resumo de preço → null. */
export function espalhamentoPct(preco: { min: number; mediana: number; max: number } | null): number | null {
  if (preco == null || preco.min <= 0) return null;
  return ((preco.max - preco.min) / preco.min) * 100;
}

/** Visitas do anúncio ganhador ÷ nº de ofertas (D7: rótulo avisa que é do item mais barato). */
export function visitasPorOferta(visitas30d: number | null, ofertas: number): number | null {
  if (visitas30d == null || ofertas === 0) return null;
  return visitas30d / ofertas;
}

/** Vendedor com mais transações confirmadas (transacoes_total não-null) entre os da ficha. */
export function vendedorMaisForte(
  vendedores: Array<{ seller_id: number; uf: string | null; transacoes_total: number | null }>,
): { seller_id: number; uf: string | null; transacoes_total: number } | null {
  let melhor: { seller_id: number; uf: string | null; transacoes_total: number } | null = null;
  for (const v of vendedores) {
    if (v.transacoes_total == null) continue;
    if (melhor == null || v.transacoes_total > melhor.transacoes_total) {
      melhor = { seller_id: v.seller_id, uf: v.uf, transacoes_total: v.transacoes_total };
    }
  }
  return melhor;
}

/** Dias inteiros entre `iso` e `agora`. Sem data/data inválida → null. */
export function diasDesde(iso: string | null, agora: Date): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((agora.getTime() - d.getTime()) / 86_400_000);
}
