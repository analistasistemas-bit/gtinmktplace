// ADR-0135 — resolução de itens ML por família (Legacy vs User Products) e cálculo do semáforo
// can_invoice. Extraído de sincronizar-fiscal-ml na Task 8 pra não duplicar (e divergir) essa
// semântica entre o worker de push e a reconciliação periódica de monitorar-moderados (D-10).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ItemFiscalUP { sku: string; item_externo_id: string | null }

export type LerCanInvoice = (token: string, itemId: string) =>
  Promise<{ pronto: boolean; causa: string | null } | null>;

/** Filhos User Products (ADR-0088) — partição 0, mesmo padrão de vincular-catalogo/vinculacao.ts.
 *  `[]` = família Legacy (1 item só, em familias.ml_item_id). Erro de leitura LANÇA — nunca
 *  degrada pra lista vazia (Task 7, fix round 3, Q1: silenciar aqui fazia UP cair no fallback
 *  Legacy e vincular/checar todo SKU no item errado). */
export async function listarItensUP(
  admin: SupabaseClient, orgId: string, codigoPai: string,
): Promise<ItemFiscalUP[]> {
  const { data: raizes, error: errRaizes } = await admin.from('anuncios_externos')
    .select('id').eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('canal', 'mercado_livre').eq('particao', 0);
  if (errRaizes) throw new Error(`listarItensUP (raízes): ${errRaizes.message}`);
  const rootIds = (raizes ?? []).map((r: { id: string }) => r.id);
  if (rootIds.length === 0) return [];
  const { data: itens, error: errItens } = await admin.from('anuncios_externos_itens')
    .select('sku, item_externo_id').in('anuncio_externo_id', rootIds).eq('retirado', false);
  if (errItens) throw new Error(`listarItensUP (itens): ${errItens.message}`);
  return itens ?? [];
}

/** IDs distintos a checar pra uma família: rota UP usa os itens dos filhos já resolvidos (SKU
 *  órfão — sem item_externo_id — fica de fora; é o worker de push que trata órfão como pendência,
 *  a reconciliação só lê o que já existe); Legacy usa o único item de familias.ml_item_id. */
export function idsParaChecar(itensUP: ItemFiscalUP[], mlItemId: string | null): string[] {
  return itensUP.length > 0
    ? Array.from(new Set(itensUP.map((i) => i.item_externo_id).filter((id): id is string => !!id)))
    : (mlItemId ? [mlItemId] : []);
}

/** AND do semáforo sobre 1+ itens ML. `citarItem` prefixa a causa com o item (rota UP, vários
 *  itens); em Legacy (1 item só) a causa fica igual à do ML, sem prefixo. Retorna `null` se
 *  QUALQUER leitura falhar (transitório) — nunca regride um estado já gravado por causa de 1
 *  item que falhou ao responder (Task 7, I7). */
export async function calcularSemaforoCanInvoice(
  token: string, itemIds: string[], ler: LerCanInvoice, citarItem: boolean,
): Promise<{ pronto: boolean; causa: string | null } | null> {
  if (itemIds.length === 0) return null;
  const resultados = await Promise.all(
    itemIds.map(async (itemId) => ({ itemId, r: await ler(token, itemId) })),
  );
  if (!resultados.every(({ r }) => r != null)) return null;
  const falha = resultados.find(({ r }) => !r!.pronto);
  const pronto = !falha;
  const causa = falha ? (citarItem ? `item ${falha.itemId}: ${falha.r!.causa}` : falha.r!.causa) : null;
  return { pronto, causa };
}
