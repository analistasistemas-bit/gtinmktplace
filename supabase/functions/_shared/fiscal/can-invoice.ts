// ADR-0135 — resolução de itens ML por família (Legacy vs User Products) e cálculo do semáforo
// can_invoice. Extraído de sincronizar-fiscal-ml na Task 8 pra não duplicar (e divergir) essa
// semântica entre o worker de push e a reconciliação periódica de monitorar-moderados (D-10).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ItemFiscalUP { sku: string; item_externo_id: string | null }

export type LerCanInvoice = (token: string, sku: string) =>
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

/** C1 (auditoria fiscal 19/10): itens por SKU de um produto em SPLIT (ADR-0048) — N anúncios
 *  Legacy (partições), cada um com seus SKUs em `variacoes_externas`. Antes só UP era coberto;
 *  no split o worker usava `familias.ml_item_id` (partição 0) pra TODOS os SKUs.
 *  UP não-vazio vence (intacto). Sem partição > 0 → `[]` (Legacy de 1 anúncio: fallback
 *  `familias.ml_item_id`). SKU sem partição: raiz herdada só em `familias.ml_item_id` (sem linha
 *  de partição 0) → `mlItemIdRaiz`; senão `null` (órfão → semáforo false com causa). */
export async function listarItensFiscais(
  admin: SupabaseClient, orgId: string, codigoPai: string, skus: string[], mlItemIdRaiz: string | null, split = false,
): Promise<ItemFiscalUP[]> {
  const up = await listarItensUP(admin, orgId, codigoPai);
  if (up.length > 0) return up;
  const { data, error } = await admin.from('anuncios_externos')
    .select('particao, item_externo_id, variacoes_externas')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('canal', 'mercado_livre');
  if (error) throw new Error(`listarItensFiscais: ${error.message}`);
  const linhas = (data ?? []) as Array<{
    particao: number; item_externo_id: string | null; variacoes_externas: Record<string, unknown> | null;
  }>;
  // `split` (job do split): partição 1 pode ter falhado e só existir a linha da 0 — sem a flag isso
  // caía no fallback Legacy e vinculava os SKUs da partição 1 ao item da 0 (C1 r1).
  if (!split && !linhas.some((l) => l.particao > 0)) return [];
  const temLinhaRaiz = linhas.some((l) => l.particao === 0);
  return skus.map((sku) => {
    const linha = linhas.find((l) => sku in (l.variacoes_externas ?? {}));
    return {
      sku,
      item_externo_id: linha ? linha.item_externo_id : (temLinhaRaiz ? null : mlItemIdRaiz),
    };
  });
}

/** Códigos das variações (não excluídas da publicação) de uma família — o universo completo de
 *  SKUs que DEVERIAM ter item vinculado no ML. Fix (achado do review final): a reconciliação de
 *  monitorar-moderados chamava `skusOrfaosUP` com os SKUs dos PRÓPRIOS itensUP em vez dos SKUs
 *  reais da família — variação sem NENHUMA linha em anuncios_externos_itens ficava invisível
 *  (nunca detectada como órfã), podendo reescrever `true` onde o worker de push já tinha marcado
 *  `false`. Mesma query que sincronizar-fiscal-ml/index.ts usa pra montar o payload; erro de
 *  leitura LANÇA — nunca degrada pra [] (o mesmo padrão de listarItensUP acima). */
export async function listarSkusFamilia(
  admin: SupabaseClient, familiaId: string,
): Promise<string[]> {
  const { data, error } = await admin.from('variacoes')
    .select('codigo').eq('familia_id', familiaId).eq('excluida_da_publicacao', false);
  if (error) throw new Error(`listarSkusFamilia: ${error.message}`);
  return (data ?? []).map((v: { codigo: string }) => v.codigo);
}

/** SKUs da rota UP sem item_externo_id resolvido (pendente/criacao_incerta no ML). Presença de
 *  QUALQUER um aqui é pendência — nunca pode ficar de fora do resultado em silêncio (Task 7 Q3:
 *  o can_invoice por SKU não diz se o SKU está vinculado a um anúncio; sem este gate, 1 SKU sem
 *  item + resto pronto reconciliaria a família inteira como `true`). `[]` em Legacy (itensUP vazio) — lá não
 *  existe o conceito de "SKU sem item", é sempre o único item de ml_item_id. */
export function skusOrfaosUP(skus: string[], itensUP: ItemFiscalUP[]): string[] {
  if (itensUP.length === 0) return [];
  const itemIdPorSku = new Map(itensUP.map((i) => [i.sku, i.item_externo_id]));
  return skus.filter((sku) => !itemIdPorSku.get(sku));
}

/** AND do semáforo sobre os SKUs da família (emenda D-10: leitura por SKU em fiscal_information);
 *  a causa cita o SKU que derrubou. Retorna `null` se QUALQUER leitura falhar (transitório) —
 *  nunca regride um estado já gravado por causa de 1 SKU que falhou ao responder (Task 7, I7).
 *  Chamar só depois de `skusOrfaosUP`: o vínculo SKU→anúncio não é legível pela API. */
export async function calcularSemaforoCanInvoice(
  token: string, skus: string[], ler: LerCanInvoice,
): Promise<{ pronto: boolean; causa: string | null } | null> {
  if (skus.length === 0) return null;
  const resultados = await Promise.all(
    skus.map(async (sku) => ({ sku, r: await ler(token, sku) })),
  );
  if (!resultados.every(({ r }) => r != null)) return null;
  const falha = resultados.find(({ r }) => !r!.pronto);
  return { pronto: !falha, causa: falha ? `SKU ${falha.sku}: ${falha.r!.causa}` : null };
}
