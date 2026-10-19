// ADR-0135 D-10 — reconciliação do semáforo fiscal, pendurada no worker de status (6/6h).
// Decisão de execução: o cron horário (reconciliar-faturamento) tem orçamento de 120s já
// apertado; o push fiscal atualiza o semáforo na hora (sincronizar-fiscal-ml), então 6h só
// afeta mudança por fora do fluxo do app (ex.: alteração manual no ML).
//
// Emenda D-10 (19/10/2026): o semáforo lê o can_invoice de CADA SKU da família em
// fiscal_information (o /can_invoice/items dá 403 pro app). Reusa o mesmo gate de SKU órfão e o
// mesmo AND-com-citação de _shared/fiscal/can-invoice.ts que sincronizar-fiscal-ml usa no push,
// pra não ter duas semânticas divergentes.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  calcularSemaforoCanInvoice, listarItensFiscais as listarItensFiscaisReal,
  listarSkusFamilia as listarSkusFamiliaReal, skusOrfaosUP, type LerCanInvoice,
} from '../_shared/fiscal/can-invoice.ts';

export type { LerCanInvoice };

interface FamiliaCanInvoice {
  id: string;
  codigo_pai: string;
  ml_item_id: string | null;
  can_invoice: boolean | null;
  can_invoice_causa: string | null;
}

export async function reconciliarCanInvoice(
  admin: SupabaseClient, orgId: string, token: string, ler: LerCanInvoice,
  // Injeção pro mesmo padrão de deps de sincronizar-fiscal-ml — default é a implementação real
  // (mesma query, mesma trava contra erro de leitura degradar em silêncio).
  listarItensFiscais: (
    admin: SupabaseClient, orgId: string, codigoPai: string, skus: string[], mlItemIdRaiz: string | null,
  ) => ReturnType<typeof listarItensFiscaisReal> = listarItensFiscaisReal,
  // Fix (achado do review final): MESMO universo de SKU órfão que o worker de push usa — os
  // códigos de `variacoes` da família, não os SKUs dos próprios itensUP (ver comentário em
  // _shared/fiscal/can-invoice.ts#listarSkusFamilia).
  listarSkusFamilia: (admin: SupabaseClient, familiaId: string) => ReturnType<typeof listarSkusFamiliaReal> = listarSkusFamiliaReal,
): Promise<number> {
  const { data: org, error: orgErr } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', orgId).maybeSingle();
  if (orgErr) throw new Error(`reconciliarCanInvoice: organizations: ${orgErr.message}`);
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) return 0;

  const { data: familias, error: familiasErr } = await admin.from('familias')
    .select('id, codigo_pai, ml_item_id, can_invoice, can_invoice_causa').eq('org_id', orgId)
    .not('ml_item_id', 'is', null).eq('status', 'publicado');
  // Erro de leitura NUNCA degrada pra lista vazia (lição do round 3 da Task 7) — propaga, quem
  // chama (monitorar-moderados/index.ts) já embrulha essa chamada em try/catch por conexão.
  if (familiasErr) throw new Error(`reconciliarCanInvoice: familias: ${familiasErr.message}`);

  let atualizadas = 0;
  for (const f of (familias ?? []) as FamiliaCanInvoice[]) {
    // Review Codex (emenda D-10): o can_invoice por SKU não enxerga o vínculo SKU→anúncio. Recusa
    // gravada pelo worker de push (causa "push…", ex.: vínculo 400) só é limpa por um novo push,
    // que refaz o vínculo — senão a reconciliação a promoveria a verde com o vínculo recusado.
    if (f.can_invoice === false && f.can_invoice_causa?.startsWith('push')) continue;

    // Fix round 1 (T8): SKU UP sem item resolvido é pendência, igual ao worker de push — nunca
    // pode ficar de fora do AND em silêncio (a família reconciliaria como `true` com 1 SKU
    // nunca vinculado no ML). Mesmo gate de sincronizar-fiscal-ml/processar.ts, mesma causa;
    // short-circuit ANTES de ler can_invoice no ML, como o worker também faz.
    // Fix (review final): universo de SKU vem de `variacoes` da família — os SKUs dos PRÓPRIOS
    // itensUP (como antes) tornam invisível a variação sem NENHUMA linha em
    // anuncios_externos_itens; ela nunca aparecia como órfã. Emenda D-10: os mesmos SKUs são o que
    // o semáforo lê (fiscal_information por SKU), então a busca vale pra Legacy também.
    const skus = await listarSkusFamilia(admin, f.id);
    // C1 (auditoria 19/10): split também resolve item por SKU (partição), não só UP.
    const itensUP = await listarItensFiscais(admin, orgId, f.codigo_pai, skus, f.ml_item_id);
    const skusOrfaos = skusOrfaosUP(skus, itensUP);
    if (skusOrfaos.length > 0) {
      const { error } = await admin.from('familias').update({
        can_invoice: false, can_invoice_causa: `SKU(s) sem item vinculado no ML: ${skusOrfaos.join(', ')}`,
        can_invoice_em: new Date().toISOString(),
      }).eq('id', f.id);
      if (!error) atualizadas += 1;
      continue;
    }

    const resultado = await calcularSemaforoCanInvoice(token, skus, ler);
    if (!resultado) continue; // falha de leitura do ML não regride o estado gravado (I7)
    const { error } = await admin.from('familias').update({
      can_invoice: resultado.pronto, can_invoice_causa: resultado.causa,
      can_invoice_em: new Date().toISOString(),
    }).eq('id', f.id);
    if (!error) atualizadas += 1;
  }
  return atualizadas;
}
