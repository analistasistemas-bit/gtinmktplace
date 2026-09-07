import { supabase } from '@/lib/supabase';
import type { CommercialTerms } from '../../supabase/functions/_shared/platform-admin/types';

export * from '../../supabase/functions/_shared/platform-admin/types';

function fortalezaDateParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

export function todayInFortaleza(now = new Date()): string {
  const { year, month, day } = fortalezaDateParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Condição vigente hoje (não confundir com a condição resolvida para o mês da prévia, que pode
 *  ser passado). Usada por `org-billing.tsx` (decide se o card de condições abre recolhido) e por
 *  `commercial-terms-form.tsx` (classifica o histórico como Vigente/Anterior). */
export function effectiveTerm(rows: CommercialTerms[], today: string): CommercialTerms | null {
  return rows
    .filter((row) => row.starts_on <= today)
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.version - a.version)[0] ?? null;
}

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
