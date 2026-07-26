export type SupportScope = 'read' | 'full';

export type SupportAction =
  | { action: 'list'; orgId?: string; page: number; pageSize: number; status?: 'pending' | 'active' | 'actionable' | 'history' }
  | { action: 'request'; orgId: string; scope: SupportScope; reason: string }
  | { action: 'cancel' | 'start' | 'end' | 'revoke'; requestId: string }
  | { action: 'decide'; requestId: string; decision: 'approved' | 'rejected' }
  | { action: 'context' };

export function resolverRenovacao(active: { id: string; org_id: string; expires_at: string | null } | null, orgId: string, now = new Date()): string | null {
  if (!active) return null;
  if (active.org_id !== orgId) throw new Error('renovação exige a mesma organização');
  if (!active.expires_at || new Date(active.expires_at).getTime() - now.getTime() > 15 * 60_000) throw new Error('renovação permitida somente nos 15 minutos finais');
  return active.id;
}

export function autorizarRequestSuporte(
  action: 'cancel' | 'decide' | 'start' | 'end' | 'revoke',
  request: { requester_id: string; org_id: string }, actorId: string,
  actor: { isAdmin: boolean; orgId: string | null; isSuperAdmin: boolean },
): boolean {
  const tenantAdmin = actor.isAdmin && actor.orgId === request.org_id && !actor.isSuperAdmin;
  if (action === 'decide' || action === 'revoke') {
    if (!tenantAdmin) throw new Error('forbidden');
  } else if (!actor.isSuperAdmin || request.requester_id !== actorId) throw new Error('forbidden');
  return tenantAdmin;
}

export function podeExcluirLote(ownerId: string, actorId: string, support: boolean): boolean {
  return support || ownerId === actorId;
}

function id(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new Error(`${field} obrigatório`);
  return result;
}

function positiveInteger(value: unknown, fallback: number, field: string, max: number): number {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) throw new Error(`${field} inválido`);
  return value as number;
}

export function validarAcaoSuporte(body: unknown): SupportAction {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  switch (value.action) {
    case 'list':
      {
        const page = positiveInteger(value.page, 1, 'página', Number.MAX_SAFE_INTEGER);
        const pageSize = positiveInteger(value.page_size, 50, 'page_size', 50);
        const status = value.status;
        if (status != null && status !== 'pending' && status !== 'active' && status !== 'actionable' && status !== 'history') throw new Error('status inválido');
        return {
          action: 'list', page, pageSize,
          ...(value.org_id == null ? {} : { orgId: id(value.org_id, 'org_id') }),
          ...(status == null ? {} : { status }),
        };
      }
    case 'request': {
      const scope = value.scope;
      if (scope !== 'read' && scope !== 'full') throw new Error('escopo inválido');
      const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
      if (reason.length < 1 || reason.length > 1000) throw new Error('motivo deve ter entre 1 e 1000 caracteres');
      return { action: 'request', orgId: id(value.org_id, 'org_id'), scope, reason };
    }
    case 'cancel': case 'start': case 'end': case 'revoke':
      return { action: value.action, requestId: id(value.request_id, 'request_id') };
    case 'decide':
      if (value.decision !== 'approved' && value.decision !== 'rejected') throw new Error('decisão inválida');
      return { action: 'decide', requestId: id(value.request_id, 'request_id'), decision: value.decision };
    case 'context': return { action: 'context' };
    default: throw new Error('ação inválida');
  }
}

type SupportRequestForTransition = {
  requester_id: string;
  status: string;
  pending_expires_at?: string | null;
  approval_expires_at?: string | null;
  expires_at?: string | null;
};

function vigente(value: string | null | undefined, now: Date, message: string): void {
  if (!value || new Date(value) <= now) throw new Error(message);
}

export function validarTransicaoSuporte(
  action: 'cancel' | 'decide' | 'start' | 'end' | 'revoke',
  request: SupportRequestForTransition,
  actorId: string,
  isAdmin: boolean,
  now = new Date(),
): void {
  if (action === 'cancel') {
    if (request.status !== 'pending' || request.requester_id !== actorId) throw new Error('transição inválida');
    return vigente(request.pending_expires_at, now, 'pedido expirado');
  }
  if (action === 'decide') {
    if (request.status !== 'pending') throw new Error('transição inválida');
    if (!isAdmin) throw new Error('administrador necessário');
    if (request.requester_id === actorId) throw new Error('solicitante não pode decidir');
    return vigente(request.pending_expires_at, now, 'pedido expirado');
  }
  if (action === 'start') {
    if (request.status !== 'approved' || request.requester_id !== actorId) throw new Error('transição inválida');
    return vigente(request.approval_expires_at, now, 'aprovação expirada');
  }
  if (action === 'end') {
    if (request.status !== 'active' || request.requester_id !== actorId) throw new Error('transição inválida');
    return vigente(request.expires_at, now, 'sessão expirada');
  }
  if (request.status !== 'active') throw new Error('transição inválida');
  if (!isAdmin) throw new Error('administrador necessário');
  return vigente(request.expires_at, now, 'sessão expirada');
}
