// Leituras multiget do worker PxV, extraídas de index.ts para teste (ADR-0177). Mesma semântica de antes.
import { corDaVariacaoML } from '../_shared/ml/atualizar-item.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';

const API = 'https://api.mercadolibre.com';

/** COLOR dos anúncios NOVOS. Lança em HTTP de erro (o worker reagenda). Ordem do original:
 *  lista vazia → nada (nem token); senão token → URL → fetch. */
export async function lerCoresML(getToken: () => Promise<string>, itemIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (itemIds.length === 0) return out;
  const token = await getToken();
  const url = `${API}${caminhoMultiget(itemIds, 'id,attributes')}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  // Lança em vez de devolver mapa vazio: um 5xx transitório do ML viraria "nenhuma cor lida" →
  // casamento falho → `erro` definitivo, com a migração já concluída do outro lado. O catch do
  // worker trata como transitório e reagenda dentro do orçamento.
  if (!resp.ok) throw new Error(`multiget de cores falhou (${resp.status})`);
  const json = comoEnvelopeAntigo(await resp.json(), itemIds) as Array<{ code?: number; body?: { id?: string; attributes?: unknown } }>;
  for (const linha of json ?? []) {
    if (linha?.code !== 200 || !linha.body?.id) continue;
    out.set(String(linha.body.id), corDaVariacaoML(linha.body.attributes));
  }
  return out;
}

/** Estoque vivo por item. HTTP de erro → mapa vazio. Ordem do original: lista vazia → nada (nem token);
 *  senão URL → token (dentro dos headers) → fetch. */
export async function lerEstoqueVivoML(getToken: () => Promise<string>, ids: string[]): Promise<Map<string, number>> {
  const vivoPorItem = new Map<string, number>();
  if (ids.length === 0) return vivoPorItem;
  const url = `${API}${caminhoMultiget(ids, 'id,available_quantity')}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (resp.ok) {
    const json = comoEnvelopeAntigo(await resp.json(), ids) as Array<{ code?: number; body?: { id?: string; available_quantity?: number } }>;
    for (const l of json ?? []) {
      if (l?.code === 200 && l.body?.id) vivoPorItem.set(String(l.body.id), l.body.available_quantity ?? 0);
    }
  }
  return vivoPorItem;
}
