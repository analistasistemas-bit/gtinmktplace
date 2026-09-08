// ADR-0161 — casamento cor → anúncio novo, depois da migração UPtin.
//
// Depois que o ML encerra o item original, é preciso descobrir QUAL anúncio novo corresponde a qual
// cor. Errar aqui é pior que falhar: adotar o anúncio de outro produto faria o app gerenciar preço e
// estoque alheios, com resposta 200 e nenhum sinal.
//
// Por isso os dois degraus usam SOMENTE ids que o próprio ML atribuiu a ESTE item — `new_items[]` do
// `migration_live_listing` cruzado com o snapshot tirado ANTES do disparo. A descoberta por título
// (`?q=`, ADR-0105) fica de fora deste caminho: ela localiza por texto e valida apenas que o
// `family_id` seja único, então uma família IRMÃ do mesmo vendedor — mesmo título, mesmas cores,
// produto parecido já migrado antes — passaria na validação e casaria 1:1 com o produto errado.

import { normalizarCodigo } from '../parser.ts';
import type { VariacaoSnapshot } from '../ml/migracao-pxv.ts';

export interface NovoItemML {
  itemId: string;
  variationId: string;
  /** COLOR do anúncio novo, lida pelo chamador (degrau b). `undefined` = ainda não lida. */
  cor?: string | null;
}

export type ResultadoCasamento =
  | { tipo: 'ok'; itemPorSku: Map<string, string>; degrau: 'variation_id' | 'cor' }
  | { tipo: 'falha'; motivo: string };

/**
 * Casa `new_items` com o snapshot.
 *
 * `variacoesLocais` (sku → `ml_variation_id`) é o desempate para snapshot sem `seller_custom_field`:
 * o ML não exige SKU na variação, e sem ele o degrau (a) não teria como nomear a cor. Os ids são do
 * mesmo item, então não há ambiguidade.
 */
export function casarNovosItens(
  snapshot: VariacaoSnapshot[],
  novosItens: NovoItemML[],
  variacoesLocais: Array<{ codigo: string; mlVariationId: string | null }>,
): ResultadoCasamento {
  if (novosItens.length === 0) {
    return { tipo: 'falha', motivo: 'O Mercado Livre não informou os anúncios criados na migração.' };
  }

  const skuPorVariationLocal = new Map<string, string>();
  for (const v of variacoesLocais) {
    if (v.mlVariationId) skuPorVariationLocal.set(String(v.mlVariationId), normalizarCodigo(v.codigo));
  }

  // ── Degrau (a): variation_id → snapshot → SKU ──────────────────────────────────────────────
  const skuPorVariation = new Map<string, string>();
  for (const v of snapshot) {
    const sku = v.sku != null && v.sku !== ''
      ? normalizarCodigo(v.sku)
      // SKU ausente no snapshot: cai para o vínculo local pelo MESMO id de variação.
      : skuPorVariationLocal.get(v.id) ?? null;
    if (sku) skuPorVariation.set(v.id, sku);
  }

  const porVariationId = new Map<string, string>();
  for (const n of novosItens) {
    const sku = skuPorVariation.get(n.variationId);
    if (sku) porVariationId.set(sku, n.itemId);
  }
  if (porVariationId.size === novosItens.length && porVariationId.size > 0) {
    return { tipo: 'ok', itemPorSku: porVariationId, degrau: 'variation_id' };
  }

  // ── Degrau (b): COLOR do anúncio novo → cor do snapshot ────────────────────────────────────
  // Só vale se o chamador leu a cor de TODOS os novos; cor parcial casaria alguns e deixaria outros
  // órfãos, e adoção parcial é proibida (tudo-ou-nada, ADR-0104).
  const todosComCor = novosItens.every((n) => n.cor !== undefined);
  if (todosComCor) {
    const skuPorCor = new Map<string, string>();
    for (const v of snapshot) {
      const cor = (v.cor ?? '').trim().toLowerCase();
      const sku = v.sku != null && v.sku !== ''
        ? normalizarCodigo(v.sku)
        : skuPorVariationLocal.get(v.id) ?? null;
      if (!cor || !sku) continue;
      // Cor repetida no snapshot torna a chave ambígua — o disparo já recusa esse caso, mas se algo
      // mudou no ML entre o snapshot e agora, é aqui que se descobre. Não escolher é o certo.
      if (skuPorCor.has(cor)) {
        return { tipo: 'falha', motivo: `Duas variações com a mesma cor ("${v.cor}") — não dá para casar sem ambiguidade.` };
      }
      skuPorCor.set(cor, sku);
    }
    const porCor = new Map<string, string>();
    for (const n of novosItens) {
      const cor = (n.cor ?? '').trim().toLowerCase();
      const sku = cor ? skuPorCor.get(cor) : undefined;
      if (sku) porCor.set(sku, n.itemId);
    }
    if (porCor.size === novosItens.length && porCor.size > 0) {
      return { tipo: 'ok', itemPorSku: porCor, degrau: 'cor' };
    }
  }

  // ── Sem degrau (c) ────────────────────────────────────────────────────────────────────────
  // Falhar aqui deixa a família em erro, e o caminho do ADR-0105 (descoberta por título dentro do
  // UPDATE) continua disponível para o operador — com a diferença de que lá a decisão é dele, não
  // uma adoção automática que pode pegar o produto errado.
  const casados = Math.max(porVariationId.size, 0);
  return {
    tipo: 'falha',
    motivo: `Não foi possível casar as cores com os anúncios novos (${casados} de ${novosItens.length}). `
      + 'Nada foi alterado. Publique uma atualização para o app reconciliar.',
  };
}
