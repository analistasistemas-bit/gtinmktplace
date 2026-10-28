// Ação de pós-venda no ML (revisar devolução, responder, reembolsar, autorizar devolução, abrir
// disputa) — ADR-0192. Chamada pelo frontend (JWT) após o clique + confirmação na tela. Qualquer membro
// com escrita na org executa; quem clicou fica em ml_posvenda_acoes.user_id. Máquina de estados,
// trava e idempotência em _shared/faturamento/posvenda-fluxo.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { executarAcao, type BodyAcao } from '../_shared/faturamento/posvenda-fluxo.ts';
import { depsAcaoReal } from '../_shared/faturamento/posvenda-acao-io.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status: number) => json({ ok: false, erro: msg }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = context;

  let body: BodyAcao;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body || typeof body !== 'object') return erro('body inválido', 400);
  const claimId = String(body.claim_id ?? '').trim();
  if (!/^\d+$/.test(claimId)) return erro('claim_id inválido', 400);

  const admin = adminClient();
  // Pertencimento antes de qualquer chamada ao ML.
  const { data: dev } = await admin.from('ml_devolucoes').select('claim_id, return_id')
    .eq('org_id', orgId).eq('claim_id', claimId).maybeSingle();
  if (!dev) return erro('Reclamação não encontrada.', 404);

  const { data: cxRow } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(cxRow ?? null);
  const dono = (cxRow?.criado_por as string | null) ?? null;
  if (!conexao || !conexao.contaExternaId || !dono) return erro('Conta ML não conectada.', 400);

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return erro('Conta ML não conectada.', 400); }

  const deps = depsAcaoReal(admin, { orgId, connectionId: conexao.id, contaExternaId: conexao.contaExternaId, dono, token });
  let r;
  try {
    r = await executarAcao(deps, {
      orgId, userId, claimId: Number(claimId),
      returnIdLocal: dev.return_id == null ? null : Number(dev.return_id),
      body: { ...body, claim_id: claimId },
    });
  } catch (e) {
    // Erro de banco no meio: o estado gravado é a verdade; "Conferir" com o mesmo operacao_id retoma sem POST.
    console.error(`[posvenda-acao] claim ${claimId} org ${orgId}:`, (e as Error).message);
    await auditarOperacaoSuporte(admin, context, { type: 'claim', id: claimId }, 'failed').catch(() => {});
    return erro('Falha interna ao registrar a ação. Use "Conferir" antes de tentar de novo.', 500);
  }
  if (!body.verificar) {
    // A ação no ML já aconteceu: falha de auditoria não pode virar 500 (o cliente repetiria às cegas).
    await auditarOperacaoSuporte(admin, context, { type: 'claim', id: claimId }, r.ok ? 'succeeded' : 'failed')
      .catch((e) => console.error('[posvenda-acao] auditoria de suporte falhou:', (e as Error).message));
  }
  const { http, ...corpo } = r;
  return json(corpo, http);
});
