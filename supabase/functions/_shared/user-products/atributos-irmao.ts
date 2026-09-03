// Atributos de ficha herdados de um item irmão ao criar uma cor nova numa família User Products.
//
// Incidente 03/09/2026 (`MLB4959919693`, lote 54): o app criou a cor Preta e o ML a colocou numa
// família NOVA (`family_id` 6941552057270415 contra 3799502520089361 das outras 9). O guard do
// ADR-0088 pausou o item e travou o UPDATE — de propósito, para não deixar um anúncio órfão
// vendendo separado. Medido nos `user-products` dos dois lados, a identidade divergia em:
//   · BRAND/MANUFACTURER — item novo com `BUFALO` (texto cru do campo fornecedor, sem `value_id`);
//     os de 28/07 com `Búfalo` + `value_id` 9165622, porque o ML normalizou pelo dicionário na
//     criação em lote. Mesma classe da normalização de COLOR.
//   · COMPOSITION — `100% poliéster` (`value_id` 4904381) nos antigos, ausente no novo: esse
//     atributo NUNCA sai daqui (`familias.atributos_ml` não o tem), veio do enriquecimento do
//     próprio ML na criação.
//
// A correção é não deixar a divergência nascer: a cor nova copia a ficha do irmão exatamente
// como ela está NO ML, `value_id` inclusive.
import type { AtributoItem } from '../canais/contrato.ts';

/** Atributos que são por SKU e NUNCA podem ser copiados do irmão — copiá-los publicaria a cor
 *  nova com a cor/código de barras da cor antiga. */
const POR_SKU = new Set(['COLOR', 'GTIN', 'EMPTY_GTIN_REASON', 'SELLER_SKU']);

/** Dimensões/peso da embalagem. Ficam de fora da herança: são dado NOSSO, definem frete
 *  (ADR-0018) e o caminho UP não as sincroniza depois da criação — herdar do irmão fixaria no
 *  item novo um peso desatualizado para sempre. **Validado em produção (03/09/2026):** com a
 *  ficha herdada e as dimensões do banco (2200 g × 2330 g dos irmãos), o ML agrupou —
 *  `MLB7586017842` nasceu no `family_id` 3799502520089361. Dimensão não entra na identidade da
 *  família. */
const PREFIXO_PACOTE = 'SELLER_PACKAGE_';

interface AtributoCru {
  id?: unknown;
  value_id?: unknown;
  value_name?: unknown;
}

/**
 * Ficha do irmão pronta para o payload da cor nova: preserva `value_id` quando o ML tem um
 * (é o que faz o valor casar com o dicionário em vez de virar texto livre) e descarta o que é
 * por SKU ou de embalagem.
 */
export function atributosDeFicha(attrs: unknown): AtributoItem[] {
  if (!Array.isArray(attrs)) return [];
  const out: AtributoItem[] = [];
  for (const cru of attrs as AtributoCru[]) {
    const id = typeof cru?.id === 'string' ? cru.id : null;
    if (!id || POR_SKU.has(id) || id.startsWith(PREFIXO_PACOTE)) continue;
    const valueId = cru.value_id != null ? String(cru.value_id) : null;
    const valueName = cru.value_name != null ? String(cru.value_name) : null;
    if (valueId) out.push({ id, value_id: valueId } as AtributoItem);
    else if (valueName) out.push({ id, value_name: valueName } as AtributoItem);
  }
  return out;
}

/**
 * Mescla a ficha herdada com a da família. O irmão VENCE em caso de conflito: é o valor que já
 * está publicado e é ele que define se o ML agrupa. `atributos_ml` só entra no que o irmão não
 * tiver — assim um atributo novo da família continua chegando ao anúncio.
 */
export function mesclarAtributos(daFamilia: unknown, doIrmao: AtributoItem[]): AtributoItem[] {
  const base = Array.isArray(daFamilia) ? (daFamilia as AtributoItem[]) : [];
  const idsDoIrmao = new Set(doIrmao.map((a) => a.id));
  return [...doIrmao, ...base.filter((a) => !idsDoIrmao.has(a.id))];
}
