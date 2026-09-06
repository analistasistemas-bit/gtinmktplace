// ADR-0154 D-8: encerra um Kit Virtual no ML e marca a linha local como `encerrado`.
//
// Padrão GET-primeiro (mesmo de remover-publicado/processar.ts): lê o estado real do item antes
// de escrever. Um `PUT status=closed` cego em item já fechado devolve 400 e travaria justamente
// o caminho de recuperação — aqui já-fechado é SUCESSO idempotente, não erro.
//
// Reusa só a primitiva de status (`buscarItemML` + `atualizarStatusML`). NÃO reusa a edge
// `remover-publicado`: aquela é inteiramente `familias`-shaped (lote, storage, saga de user
// products) e não tem nada a fazer com um kit.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface EncerrarKitVirtualDeps {
  admin: SupabaseClient;
  orgId: string;
  /** `buscarItemML` — devolve o estado ao vivo; lança com `.status` anexado em erro do ML. */
  buscarItem: (itemId: string) => Promise<{ status: string | null }>;
  /** `atualizarStatusML(token, itemId, 'closed')`. */
  fecharItem: (itemId: string) => Promise<void>;
}

export type MotivoEncerrarKitVirtual =
  | 'nao_encontrado'
  | 'falha_leitura'
  | 'ml_recusou'
  | 'falha_encerrar';

export type ResultadoEncerrarKitVirtual =
  | {
    ok: true;
    kitId: string;
    /** `true` = nada foi escrito no ML nesta chamada (já estava `closed`, ou nunca publicou). */
    jaEncerrado: boolean;
  }
  | { ok: false; motivo: MotivoEncerrarKitVirtual; mensagem?: string };

function statusHttpDoErro(e: unknown): number | null {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

export async function encerrarKitVirtual(
  deps: EncerrarKitVirtualDeps, input: { kitId: string },
): Promise<ResultadoEncerrarKitVirtual> {
  const { admin, orgId } = deps;

  const { data: kit, error } = await admin.from('kits_virtuais')
    .select('id, status, ml_item_id')
    .eq('id', input.kitId).eq('org_id', orgId).maybeSingle();
  if (error) return { ok: false, motivo: 'falha_leitura', mensagem: error.message };
  if (!kit) return { ok: false, motivo: 'nao_encontrado' };

  const linha = kit as { id: string; status: string; ml_item_id: string | null };

  if (linha.status === 'encerrado') return { ok: true, kitId: linha.id, jaEncerrado: true };

  // Nunca chegou ao ML (kit em `publicando`/`erro` sem item): encerra só localmente.
  let jaEncerrado = linha.ml_item_id == null;

  if (linha.ml_item_id) {
    let statusNoMl: string | null;
    try {
      statusNoMl = (await deps.buscarItem(linha.ml_item_id)).status;
    } catch (e) {
      // 404 = o item não existe mais no ML: encerrar é exatamente o estado desejado. Qualquer
      // outra recusa é opaca (token, posse, indisponibilidade) e NÃO pode virar "encerrado"
      // local — o kit continuaria no ar com a tela dizendo que não está.
      if (statusHttpDoErro(e) !== 404) {
        return { ok: false, motivo: 'ml_recusou', mensagem: e instanceof Error ? e.message : String(e) };
      }
      statusNoMl = 'closed';
    }

    if (statusNoMl === 'closed') {
      jaEncerrado = true;
    } else {
      try {
        await deps.fecharItem(linha.ml_item_id);
      } catch (e) {
        return { ok: false, motivo: 'ml_recusou', mensagem: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  const { error: erroUpdate } = await admin.from('kits_virtuais')
    .update({ status: 'encerrado', encerrado_em: new Date().toISOString() })
    .eq('id', linha.id).eq('org_id', orgId);
  if (erroUpdate) return { ok: false, motivo: 'falha_encerrar', mensagem: erroUpdate.message };

  return { ok: true, kitId: linha.id, jaEncerrado };
}
