import { supabase } from '@/lib/supabase';

export type SupportScope = 'read' | 'full';

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
  if (error) throw error;
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

export async function startSupport(requestId: string): Promise<void> {
  await invoke({ action: 'start', request_id: requestId });
}

export async function endSupport(requestId: string): Promise<void> {
  await invoke({ action: 'end', request_id: requestId });
}
