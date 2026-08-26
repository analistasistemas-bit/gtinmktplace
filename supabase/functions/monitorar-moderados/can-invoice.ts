// ADR-0135 D-10 — reconciliação do semáforo fiscal, pendurada no worker de status (6/6h).
// Decisão de execução: o cron horário (reconciliar-faturamento) tem orçamento de 120s já
// apertado; o push fiscal atualiza o semáforo na hora (sincronizar-fiscal-ml), então 6h só
// afeta mudança por fora do fluxo do app (ex.: alteração manual no ML).
//
// Correção ao brief original (herdado antes da Task 7 fechar o gate C1): família publicada via
// User Products (ADR-0088) tem N itens ML, um por SKU/cor — `familias.ml_item_id` só guarda o 1º
// item da partição 0. Ler só esse item faria o semáforo de UP ficar falso-verde pros N-1 outros.
// Reusa a MESMA resolução Legacy/UP e o mesmo AND-com-citação de _shared/fiscal/can-invoice.ts
// que sincronizar-fiscal-ml usa pro push, pra não ter duas semânticas divergentes.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  calcularSemaforoCanInvoice, idsParaChecar, listarItensUP as listarItensUPReal,
  type LerCanInvoice,
} from '../_shared/fiscal/can-invoice.ts';

export type { LerCanInvoice };

interface FamiliaCanInvoice {
  id: string;
  codigo_pai: string;
  ml_item_id: string | null;
}

export async function reconciliarCanInvoice(
  admin: SupabaseClient, orgId: string, token: string, ler: LerCanInvoice,
  // Injeção pro mesmo padrão de deps de sincronizar-fiscal-ml — default é a implementação real
  // (mesma query, mesma trava contra erro de leitura degradar em silêncio).
  listarItensUP: (admin: SupabaseClient, orgId: string, codigoPai: string) => ReturnType<typeof listarItensUPReal> = listarItensUPReal,
): Promise<number> {
  const { data: org, error: orgErr } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', orgId).maybeSingle();
  if (orgErr) throw new Error(`reconciliarCanInvoice: organizations: ${orgErr.message}`);
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) return 0;

  const { data: familias, error: familiasErr } = await admin.from('familias')
    .select('id, codigo_pai, ml_item_id').eq('org_id', orgId)
    .not('ml_item_id', 'is', null).eq('status', 'publicado');
  // Erro de leitura NUNCA degrada pra lista vazia (lição do round 3 da Task 7) — propaga, quem
  // chama (monitorar-moderados/index.ts) já embrulha essa chamada em try/catch por conexão.
  if (familiasErr) throw new Error(`reconciliarCanInvoice: familias: ${familiasErr.message}`);

  let atualizadas = 0;
  for (const f of (familias ?? []) as FamiliaCanInvoice[]) {
    const itensUP = await listarItensUP(admin, orgId, f.codigo_pai);
    const ids = idsParaChecar(itensUP, f.ml_item_id);
    if (ids.length === 0) continue;
    const resultado = await calcularSemaforoCanInvoice(token, ids, ler, itensUP.length > 0);
    if (!resultado) continue; // falha de leitura do ML não regride o estado gravado (I7)
    const { error } = await admin.from('familias').update({
      can_invoice: resultado.pronto, can_invoice_causa: resultado.causa,
      can_invoice_em: new Date().toISOString(),
    }).eq('id', f.id);
    if (!error) atualizadas += 1;
  }
  return atualizadas;
}
