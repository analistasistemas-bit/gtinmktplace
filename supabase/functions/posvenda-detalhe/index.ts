// Detalhe de uma reclamação/devolução do ML, relido na hora (ADR-0192). Chamada pelo frontend (JWT).
// Só lê: nenhuma escrita no ML. A reclamação precisa pertencer à org da sessão (ml_devolucoes.org_id).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { lerDetalheReclamacao } from '../_shared/faturamento/posvenda-io.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status: number) => json({ ok: false, erro: msg }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { claim_id?: unknown };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const claimId = String(body.claim_id ?? '').trim();
  if (!/^\d+$/.test(claimId)) return erro('claim_id inválido', 400);

  const admin = adminClient();
  // Pertencimento antes de qualquer chamada ao ML.
  const { data: dev } = await admin.from('ml_devolucoes').select('claim_id')
    .eq('org_id', orgId).eq('claim_id', claimId).maybeSingle();
  if (!dev) return erro('Reclamação não encontrada.', 404);

  const { data: cxRow } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(cxRow ?? null);
  if (!conexao || !conexao.contaExternaId) return erro('Conta ML não conectada.', 400);

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return erro('Conta ML não conectada.', 400); }

  try {
    const detalhe = await lerDetalheReclamacao(token, claimId, conexao.contaExternaId);
    return json({ ok: true, detalhe });
  } catch (e) {
    return erro((e as Error).message, 502);
  }
});
