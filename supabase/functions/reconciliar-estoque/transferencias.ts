// ADR-0197 (contrato de segurança, item 5): transferência pendente é reconciliada sem limite de 24 h.
// Uma cadeia viva grava `passo_em` a cada passo, no máximo T (5 min) depois do anterior; 30 min sem
// passo é cadeia perdida (retries do QStash esgotados). Reenfileirar uma viva também é seguro: o claim
// da saga serializa as invocações. `travada` espera o operador e fica de fora.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const PARADA_MS = 30 * 60 * 1000;

export async function retomarTransferenciasParadas(
  admin: SupabaseClient, enfileirar: (id: string, orgId: string) => Promise<void>, agoraMs = Date.now(),
): Promise<number> {
  // ponytail: sem paginação; transferência ativa é exceção de minutos, nunca passa de 1.000 linhas.
  const { data, error } = await admin.from('kit_transferencias').select('id, org_id')
    .eq('estado', 'ativa').lt('passo_em', new Date(agoraMs - PARADA_MS).toISOString());
  if (error) throw new Error(`kit_transferencias: ${error.message}`);
  let n = 0;
  for (const t of data ?? []) {
    try {
      await enfileirar(t.id as string, t.org_id as string);
      n++;
    } catch (e) {
      console.error('reconciliar_transferencia_enfileirar_falhou', t.id, String(e));
    }
  }
  return n;
}
