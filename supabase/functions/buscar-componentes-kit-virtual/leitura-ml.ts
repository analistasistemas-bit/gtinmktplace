// Leitura multiget de buscar-componentes-kit-virtual, extraída de index.ts para teste (ADR-0177).
// Movida sem alteração: mesma semântica de antes.
import { mlGet } from '../_shared/ml/http.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';
import type { ItemBridge } from './processar.ts';

const API = 'https://api.mercadolibre.com';

// Multiget em lotes de 20 (limite do ML), mesmo padrão de _shared/ml/pedidos.ts:buscarGtinsDosItens
// — bloco que falha é ignorado (aqueles itens locais só não entram na ponte, não derrubam a busca).
// `price`/`category_id` viajam no MESMO multiget (Gap 1 do plano de entrega): preview-kit-virtual
// exige os dois por componente, e esta é a fonte confiável (service_role, org-scoped) pra eles —
// nunca o catálogo local, que não guarda preço nem categoria do ML.
export async function buscarUserProductIdsML(token: string, itemIds: string[]): Promise<ItemBridge[]> {
  const out: ItemBridge[] = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    const bloco = itemIds.slice(i, i + 20);
    const url = `${API}${caminhoMultiget(bloco, 'id,user_product_id,price,category_id')}`;
    const arr = comoEnvelopeAntigo(await mlGet(url, token), bloco);
    if (!Array.isArray(arr)) continue;
    for (const entry of arr as {
      code?: number;
      body?: { id?: string; user_product_id?: string | null; price?: number | null; category_id?: string | null };
    }[]) {
      if (entry?.code !== 200 || !entry.body?.id) continue;
      out.push({
        itemId: entry.body.id,
        userProductId: entry.body.user_product_id ?? null,
        precoAtualML: typeof entry.body.price === 'number' ? entry.body.price : null,
        categoriaMlId: entry.body.category_id ?? null,
      });
    }
  }
  return out;
}
