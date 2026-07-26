import { supabase } from '@/lib/supabase';

export type SupportScope = 'read' | 'full';

export type SupportStatus =
  | 'pending'
  | 'approved'
  | 'active'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'revoked'
  | 'ended';

export interface SupportRequest {
  id: string;
  requester_id: string;
  org_id: string;
  scope: SupportScope;
  reason: string;
  status: SupportStatus;
  created_at: string;
  pending_expires_at: string;
  approval_expires_at: string | null;
  expires_at: string | null;
  approved_at: string | null;
  started_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
  revoked_at: string | null;
  ended_at: string | null;
  decided_by: string | null;
  revoked_by: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
}

export interface SupportRequestPage {
  requests: SupportRequest[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SupportContext {
  requestId: string;
  orgId: string;
  orgName: string;
  scope: SupportScope;
  expiresAt: string;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; context?: { status?: unknown } };
  return typeof value.status === 'number'
    ? value.status
    : typeof value.context?.status === 'number' ? value.context.status : undefined;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('suporte', { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === 'function') {
      try {
        const payload = await (context as Response).json() as { error?: unknown; message?: unknown };
        if (typeof payload.error === 'string') message = payload.error;
        else if (typeof payload.message === 'string') message = payload.message;
      } catch {
        // Mantém a mensagem genérica se o corpo já foi consumido ou não é JSON.
      }
    }
    throw Object.assign(new Error(message), { status: statusOf(error) });
  }
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(data.error);
  }
  return data as T;
}

export async function fetchSupportContext(): Promise<SupportContext | null> {
  try {
    const response = await invoke<{ context: SupportContext | null }>({ action: 'context' });
    return response.context ?? null;
  } catch (error) {
    if (statusOf(error) === 403) return null;
    throw error;
  }
}

export async function listSupportRequests(input: { orgId?: string; page?: number; pageSize?: number; status?: 'pending' | 'active' | 'actionable' | 'history' } = {}): Promise<SupportRequestPage> {
  const response = await invoke<Partial<SupportRequestPage>>({
    action: 'list',
    ...(input.orgId ? { org_id: input.orgId } : {}),
    ...(input.page ? { page: input.page } : {}),
    ...(input.pageSize ? { page_size: input.pageSize } : {}),
    ...(input.status ? { status: input.status } : {}),
  });
  return { requests: response.requests ?? [], total: response.total ?? 0, page: response.page ?? input.page ?? 1, pageSize: response.pageSize ?? input.pageSize ?? 50 };
}

export async function requestSupport(input: { orgId: string; scope: SupportScope; reason: string }): Promise<SupportRequest> {
  const response = await invoke<{ request: SupportRequest }>({
    action: 'request', org_id: input.orgId, scope: input.scope, reason: input.reason,
  });
  return response.request;
}

export async function cancelSupport(requestId: string): Promise<SupportRequest> {
  const response = await invoke<{ request: SupportRequest }>({ action: 'cancel', request_id: requestId });
  return response.request;
}

export async function decideSupport(requestId: string, decision: 'approved' | 'rejected'): Promise<SupportRequest> {
  const response = await invoke<{ request: SupportRequest }>({ action: 'decide', request_id: requestId, decision });
  return response.request;
}

export async function startSupport(requestId: string): Promise<SupportRequest> {
  const response = await invoke<{ request: SupportRequest }>({ action: 'start', request_id: requestId });
  return response.request;
}

export async function endSupport(requestId: string): Promise<SupportRequest> {
  const response = await invoke<{ request: SupportRequest }>({ action: 'end', request_id: requestId });
  return response.request;
}

export async function revokeSupport(requestId: string): Promise<SupportRequest> {
  const response = await invoke<{ request: SupportRequest }>({ action: 'revoke', request_id: requestId });
  return response.request;
}
