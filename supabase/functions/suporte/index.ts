import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser, requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enviarEmailSuporte } from '../_shared/suporte-email.ts';
import { autorizarRequestSuporte, resolverRenovacao, validarAcaoSuporte, validarTransicaoSuporte } from '../_shared/support-state.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

async function auditar(db: ReturnType<typeof adminClient>, request: { id: string; org_id: string }, actorId: string | null, event: string, result: 'succeeded' | 'failed' | 'denied' = 'succeeded', target?: { type: string; id: string }) {
  const { error } = await db.from('support_audit_events').insert({
    org_id: request.org_id, support_request_id: request.id, actor_id: actorId, event, result,
    target_type: target?.type, target_id: target?.id,
  });
  if (error) throw new Error('falha ao registrar auditoria');
}

async function notificarAdmins(db: ReturnType<typeof adminClient>, request: { id: string; org_id: string }, actorId: string, text: string): Promise<string | null> {
  const { data: admins, error } = await db.from('profiles').select('id, email')
    .eq('org_id', request.org_id).eq('is_active', true).eq('is_admin', true);
  if (error) throw new Error('falha ao localizar administradores');
  if ((admins ?? []).length) {
    const { error: notificationError } = await db.from('notificacoes').insert(
      admins!.map((admin) => ({ user_id: admin.id, org_id: request.org_id, categoria: 'integracao', texto: text })),
    );
    if (notificationError) throw new Error('falha ao criar notificação in-app');
  }
  const appUrl = Deno.env.get('APP_URL') ?? '';
  const failed: string[] = [];
  let configMissing = false;
  for (const admin of admins ?? []) {
    if (!admin.email) continue;
    try {
      await enviarEmailSuporte({ to: admin.email, subject: 'Solicitação de suporte Daludi', text, appUrl });
    } catch (error) {
      failed.push(admin.id);
      configMissing ||= error instanceof Error && error.message === 'configuração de e-mail de suporte ausente';
      try { await auditar(db, request, actorId, 'notification_delivery_failed', 'failed', { type: 'email', id: admin.id }); }
      catch { /* a transição já foi persistida; não vaza detalhes de entrega */ }
    }
  }
  if (!failed.length) return null;
  return configMissing
    ? 'configuração de e-mail de suporte ausente'
    : 'notificações por e-mail não puderam ser entregues; consulte a auditoria';
}

async function expirarVencidos(db: ReturnType<typeof adminClient>, actorId: string | null, now: Date): Promise<void> {
  for (const [status, deadline] of [['pending', 'pending_expires_at'], ['approved', 'approval_expires_at'], ['active', 'expires_at']] as const) {
    const { data: stale } = await db.from('support_requests').select('id, org_id')
      .eq('status', status).lte(deadline, now.toISOString());
    for (const request of stale ?? []) {
      const { data: expired } = await db.from('support_requests').update({ status: 'expired', expired_at: now.toISOString() })
        .eq('id', request.id).eq('status', status).select('id, org_id').maybeSingle();
      if (expired) await auditar(db, expired, actorId, 'session_expired', 'succeeded', { type: 'support_request', id: expired.id });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let action;
  try { action = validarAcaoSuporte(await req.json()); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'requisição inválida' }, 400); }

  let user;
  try { user = await requireUser(req); }
  catch (response) { if (response instanceof Response) return response; throw response; }
  const db = adminClient();
  const { data: profile } = await db.from('profiles').select('org_id, is_active, is_admin, is_super_admin')
    .eq('id', user.id).maybeSingle();
  if (!profile?.is_active) return json({ error: 'perfil inativo' }, 403);
  const now = new Date();

  try {
    await expirarVencidos(db, null, now);
    if (action.action === 'context') {
      const context = await requireUserOrg(req);
      if (!context.support) return json({ context: null });
      const { data: active } = await db.from('support_requests')
        .select('id, org_id, scope, expires_at, organizations(nome)')
        .eq('id', context.support.requestId).eq('status', 'active').maybeSingle();
      if (!active?.expires_at) return json({ context: null });
      const organization = Array.isArray(active.organizations)
        ? active.organizations[0]
        : active.organizations;
      return json({
        context: {
          requestId: active.id,
          orgId: active.org_id,
          orgName: organization?.nome ?? 'Organização',
          scope: active.scope,
          expiresAt: active.expires_at,
        },
      });
    }
    if (action.action === 'list') {
      let query = db.from('support_requests').select('*').order('created_at', { ascending: false }).limit(100);
      if (profile.is_super_admin) query = query.eq('requester_id', user.id);
      else if (profile.is_admin && profile.org_id) {
        if (action.orgId && action.orgId !== profile.org_id) return json({ error: 'forbidden' }, 403);
        query = query.eq('org_id', profile.org_id);
      }
      else return json({ error: 'forbidden' }, 403);
      const { data, error } = await query;
      if (error) throw new Error('falha ao listar solicitações');
      return json({ requests: data ?? [] });
    }
    if (action.action === 'request') {
      if (!profile.is_super_admin) return json({ error: 'somente super-admin pode solicitar suporte' }, 403);
      const { data: org } = await db.from('organizations').select('id').eq('id', action.orgId).maybeSingle();
      if (!org) return json({ error: 'organização não encontrada' }, 404);
      const { data: active } = await db.from('support_requests').select('id, org_id, expires_at')
        .eq('requester_id', user.id).eq('status', 'active').maybeSingle();
      let renewalOf: string | null;
      try { renewalOf = resolverRenovacao(active, action.orgId, now); }
      catch (error) { return json({ error: error instanceof Error ? error.message : 'renovação inválida' }, 409); }
      const { data: created, error } = await db.from('support_requests').insert({
        requester_id: user.id, org_id: action.orgId, scope: action.scope, reason: action.reason, renewal_of: renewalOf,
      }).select('*').single();
      if (error || !created) return json({ error: /unique/i.test(error?.message ?? '') ? 'já existe pedido pendente' : 'falha ao criar solicitação' }, /unique/i.test(error?.message ?? '') ? 409 : 500);
      await auditar(db, created, user.id, renewalOf ? 'renewal_requested' : 'request_created', 'succeeded', { type: 'support_request', id: created.id });
      const warning = await notificarAdmins(db, created, user.id, 'Nova solicitação de suporte aguardando decisão.');
      return json({ request: created, notification_warning: warning }, 201);
    }

    const { data: request, error: requestError } = await db.from('support_requests').select('*').eq('id', action.requestId).maybeSingle();
    if (requestError || !request) return json({ error: 'solicitação não encontrada' }, 404);
    let tenantAdmin: boolean;
    try { tenantAdmin = autorizarRequestSuporte(action.action, request, user.id, { isAdmin: profile.is_admin, orgId: profile.org_id, isSuperAdmin: profile.is_super_admin }); }
    catch { return json({ error: 'forbidden' }, 403); }
    validarTransicaoSuporte(action.action, request, user.id, tenantAdmin, now);

    let patch: Record<string, string>;
    let event: string;
    if (action.action === 'cancel') { patch = { status: 'cancelled', cancelled_at: now.toISOString() }; event = 'request_cancelled'; }
    else if (action.action === 'decide') {
      patch = action.decision === 'approved'
        ? { status: 'approved', decided_by: user.id, approved_at: now.toISOString(), approval_expires_at: new Date(now.getTime() + 60 * 60_000).toISOString() }
        : { status: 'rejected', decided_by: user.id, rejected_at: now.toISOString() };
      event = action.decision === 'approved' ? 'request_approved' : 'request_rejected';
    } else if (action.action === 'start') { patch = { status: 'active', started_at: now.toISOString(), expires_at: new Date(now.getTime() + 2 * 60 * 60_000).toISOString() }; event = 'session_started'; }
    else if (action.action === 'end') { patch = { status: 'ended', ended_at: now.toISOString() }; event = 'session_ended'; }
    else { patch = { status: 'revoked', revoked_by: user.id, revoked_at: now.toISOString() }; event = 'session_revoked'; }
    const { data: updated, error: updateError } = await db.from('support_requests').update(patch)
      .eq('id', request.id).eq('status', request.status).select('*').maybeSingle();
    if (updateError || !updated) {
      await auditar(db, request, user.id, event, 'failed', { type: 'support_request', id: request.id });
      return json({ error: 'transição não disponível' }, 409);
    }
    await auditar(db, updated, user.id, event, 'succeeded', { type: 'support_request', id: updated.id });
    const warning = await notificarAdmins(db, updated, user.id, 'O estado de uma solicitação de suporte foi atualizado.');
    return json({ request: updated, notification_warning: warning });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'falha operacional' }, 409);
  }
});
