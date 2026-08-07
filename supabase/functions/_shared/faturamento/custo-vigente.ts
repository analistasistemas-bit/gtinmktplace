// Espelho servidor de `src/lib/custos.ts`: resolve o custo VIGENTE de um item de venda pela cadeia
// variação → anúncio → GTIN → código, com tie-break na linha mais recente (ADR-0108).
//
// Existe para o congelamento do ADR-0109: o custo precisa ser resolvido no instante da venda,
// dentro do `upsertVenda`, e não dá para chamar o frontend de lá. As duas cópias são amarradas
// por `tests/lib/paridade-custo-fe-be.test.ts` — mudou de um lado, muda do outro.
import { normGtin } from './venda.ts';

/** Linha de `variacoes` (com o `ml_item_id` da família já resolvido pelo catálogo). */
export interface LinhaCusto {
  custo: unknown;
  atualizado_em: unknown;
  ml_variation_id: string | null;
  ml_item_id: string | null;
  gtin: string | null;
  codigo: string | null;
}

/** O que se sabe do item vendido na hora de resolver o custo. */
export interface ItemParaCusto {
  variation_id: number | null;
  ml_item_id: string | null;
  ean: string | null;
  codigo: string | null;
}

export interface MapasCustoVigente {
  porVariacao: Map<string, number>;
  porItem: Map<string, number>;
  porGtin: Map<string, number>;
  porCodigo: Map<string, number>;
}

/** `atualizado_em` como número comparável. Ausente/inválido → -Infinity, para nunca derrubar uma
 *  linha datada (a troca exige data estritamente maior). Igual a `src/lib/custos.ts`. */
function instante(v: unknown): number {
  if (v == null) return -Infinity;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

export function montarMapasCustoVigente(rows: LinhaCusto[]): MapasCustoVigente {
  const porVariacao = new Map<string, number>();
  const porItem = new Map<string, number>();
  const porGtin = new Map<string, number>();
  const porCodigo = new Map<string, number>();
  const quando = new Map<Map<string, number>, Map<string, number>>();

  const upsertRecente = (m: Map<string, number>, k: string, custo: number, em: number) => {
    let datas = quando.get(m);
    if (!datas) { datas = new Map(); quando.set(m, datas); }
    if (!m.has(k) || em > (datas.get(k) ?? -Infinity)) { m.set(k, custo); datas.set(k, em); }
  };

  for (const v of rows) {
    const custo = Number(v.custo ?? 0);
    // isFinite antes do > 0: `Number('abc')` é NaN, e `NaN <= 0` é false — sem esta guarda um
    // custo não numérico entraria no mapa e viraria markup NaN na tela.
    if (!Number.isFinite(custo) || custo <= 0) continue;
    const em = instante(v.atualizado_em);
    if (v.ml_variation_id != null) upsertRecente(porVariacao, String(v.ml_variation_id), custo, em);
    if (v.ml_item_id != null) upsertRecente(porItem, String(v.ml_item_id), custo, em);
    if (v.gtin) upsertRecente(porGtin, normGtin(v.gtin), custo, em);
    if (v.codigo) upsertRecente(porCodigo, normGtin(v.codigo), custo, em);
  }
  return { porVariacao, porItem, porGtin, porCodigo };
}

/** Custo unitário vigente do item. null = não casou com nenhuma variação (fica sem congelar). */
export function resolverCustoVigente(m: MapasCustoVigente, item: ItemParaCusto): number | null {
  if (item.variation_id != null) {
    const x = m.porVariacao.get(String(item.variation_id));
    if (x != null) return x;
  }
  if (item.ml_item_id) {
    const x = m.porItem.get(item.ml_item_id);
    if (x != null) return x;
  }
  if (item.ean) {
    const x = m.porGtin.get(normGtin(item.ean));
    if (x != null) return x;
  }
  if (item.codigo) {
    const x = m.porCodigo.get(normGtin(item.codigo));
    if (x != null) return x;
  }
  return null;
}
