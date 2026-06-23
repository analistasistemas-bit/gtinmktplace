// IO de devoluções/claims (ADR-0037, post-purchase). Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapearDevolucao, type ClaimML, type ReturnML } from './devolucao.ts';

const API = 'https://api.mercadolibre.com';

/** GET /post-purchase/v1/claims/{id}. null em erro. */
export async function buscarClaim(token: string, claimId: string): Promise<ClaimML | null> {
  const resp = await fetch(`${API}/post-purchase/v1/claims/${claimId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  return await resp.json() as ClaimML;
}

/** GET dos returns de um claim (status/dinheiro). null se ausente/erro. */
export async function buscarReturn(token: string, claimId: string): Promise<ReturnML | null> {
  try {
    const resp = await fetch(`${API}/post-purchase/v2/claims/${claimId}/returns`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = Array.isArray(data) ? data[0] : (data?.returns?.[0] ?? data);
    if (!r) return null;
    return { status: r.status ?? null, status_money: r.status_money ?? null, subtype: r.subtype ?? null };
  } catch { return null; }
}

/** Varre /post-purchase/v1/claims/search do vendedor. Para o backfill. */
export async function buscarClaimsSeller(token: string): Promise<ClaimML[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const out: ClaimML[] = [];
  const limit = 50;
  let offset = 0;
  while (offset < 2000) {
    const params = new URLSearchParams({ sort: 'date_desc', offset: String(offset), limit: String(limit) });
    const resp = await fetch(`${API}/post-purchase/v1/claims/search?${params}`, { headers });
    if (!resp.ok) { if (offset === 0) throw new Error(`ML /claims ${resp.status}`); break; }
    const data = await resp.json();
    const results: ClaimML[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.results) ? data.results : []);
    out.push(...results);
    const total = Number(data?.paging?.total ?? out.length);
    offset += limit;
    if (results.length === 0 || offset >= total) break;
  }
  return out;
}

/** Upsert de um claim. Retorna se é novo (para alerta) e marca a venda com tem_devolucao. */
export async function upsertDevolucao(
  admin: SupabaseClient, userId: string, claim: ClaimML, ret: ReturnML | null,
): Promise<{ nova: boolean; row: ReturnType<typeof mapearDevolucao> }> {
  const row = mapearDevolucao(claim, ret);
  const { data: anterior } = await admin.from('ml_devolucoes')
    .select('id').eq('user_id', userId).eq('claim_id', row.claim_id).maybeSingle();
  const nova = !anterior;
  await admin.from('ml_devolucoes').upsert({
    user_id: userId, ...row, raw: claim as unknown as Record<string, unknown>, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'user_id,claim_id' });

  // Marca a venda relacionada (atalho p/ badge na aba Vendas).
  if (row.order_id != null) {
    await admin.from('ml_vendas').update({ tem_devolucao: true })
      .eq('user_id', userId).eq('order_id', row.order_id);
  }
  return { nova, row };
}
