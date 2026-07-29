// E6b (ADR-0094): quem sabe qual SKU vive em qual item externo é o worker, não o conector.
// Cobre as três formas de publicação: variações num item, split em N partições (ADR-0048)
// e user products com N itens planos por família (ADR-0088).
import type { EstoquePorSku } from '../canais/contrato.ts';

export interface LinhaAnuncio {
  id: string;
  canal: string;
  item_externo_id: string | null;
  variacoes_externas: Record<string, unknown> | null;
}

export interface LinhaItemUP {
  anuncio_externo_id: string;
  sku: string;
  item_externo_id: string | null;
  retirado: boolean;
  status: string;
}

export interface AlvoPush { canal: string; itemExternoId: string; estoques: EstoquePorSku[] }

export function resolverAlvosPush(
  anuncios: LinhaAnuncio[],
  itensUP: LinhaItemUP[],
  estoquePorSku: Record<string, number>,
  canalOrigem: string | null,
): AlvoPush[] {
  const alvos: AlvoPush[] = [];
  const todosSkus = Object.keys(estoquePorSku);

  for (const a of anuncios) {
    // O canal onde a venda ocorreu já se decrementou sozinho; empurrar de volta é eco inútil.
    if (canalOrigem !== null && a.canal === canalOrigem) continue;

    // ATENÇÃO — os filhos vêm ANTES do check de item_externo_id. Numa família UP
    // (ADR-0088) a linha-mãe fica com item_externo_id NULL para sempre; os ids
    // granulares vivem nos filhos (publicar-familia-up.ts:72,123). Checar o pai
    // primeiro pularia TODA família user products.
    const filhos = itensUP.filter((i) => i.anuncio_externo_id === a.id);
    if (filhos.length > 0) {
      // Cada cor é um item técnico separado, com 1 SKU cada. Filtro igual ao que
      // atualizar-familia-up.ts:92 já aplica: só item vivo e 'ativo'.
      for (const f of filhos) {
        if (f.retirado || f.status !== 'ativo' || !f.item_externo_id) continue;
        const estoque = estoquePorSku[f.sku];
        if (estoque === undefined) continue;
        alvos.push({ canal: a.canal, itemExternoId: f.item_externo_id, estoques: [{ sku: f.sku, estoque }] });
      }
      continue;
    }

    if (!a.item_externo_id) continue;

    // Item com variações (ou item plano de 1 SKU): o mapa diz quais SKUs vivem aqui.
    // Mapa vazio = anúncio sem ancoragem registrada → manda o produto inteiro.
    const skusDoAnuncio = Object.keys(a.variacoes_externas ?? {});
    const skus = skusDoAnuncio.length > 0 ? skusDoAnuncio : todosSkus;
    const estoques = skus
      .filter((sku) => estoquePorSku[sku] !== undefined)
      .map((sku) => ({ sku, estoque: estoquePorSku[sku] }));
    if (estoques.length === 0) continue;
    alvos.push({ canal: a.canal, itemExternoId: a.item_externo_id, estoques });
  }

  return alvos;
}
