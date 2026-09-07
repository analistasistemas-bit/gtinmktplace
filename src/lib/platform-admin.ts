import { supabase } from '@/lib/supabase';

export * from '../../supabase/functions/_shared/platform-admin/types';

export type PlatformAdminError = Error & { code?: string };

type ErrorPayload = {
  error?: unknown;
  code?: unknown;
};

function toPlatformAdminError(payload: ErrorPayload | null, fallback: string): PlatformAdminError {
  const message = typeof payload?.error === 'string' ? payload.error : fallback;
  const error = new Error(message) as PlatformAdminError;
  if (typeof payload?.code === 'string') error.code = payload.code;
  return error;
}

export async function callPlatformAdmin<T>(
  action: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('platform-admin', {
    body: { action, ...params },
  });

  if (error) {
    let payload: ErrorPayload | null = null;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        payload = await context.json() as ErrorPayload;
      } catch {
        // Mantém a mensagem original quando o corpo HTTP não é JSON válido.
      }
    }
    throw toPlatformAdminError(payload, error.message);
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw toPlatformAdminError(data as ErrorPayload, 'Falha na operação administrativa');
  }

  return data as T;
}
