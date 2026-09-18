import { FunctionRegion } from '@supabase/supabase-js';
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

/** Condição mais recente, inclusive a que ainda vai começar. É o que `org-billing.tsx` precisa
 *  para decidir se já existe contrato: o RPC recusa implantação quando existe QUALQUER termo, sem
 *  filtro de data, então a tela tem que enxergar o mesmo conjunto que o banco. */
export function latestTerm(rows: CommercialTerms[]): CommercialTerms | null {
  return [...rows]
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.version - a.version)[0] ?? null;
}

/** Condição vigente hoje (não confundir com a condição resolvida para o mês da prévia, que pode
 *  ser passado). Usada por `commercial-terms-form.tsx` para classificar o histórico como
 *  Vigente/Futura/Anterior. */
export function effectiveTerm(rows: CommercialTerms[], today: string): CommercialTerms | null {
  return latestTerm(rows.filter((row) => row.starts_on <= today));
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
  // Postgres roda em us-east-1; sem `region` a função executa em sa-east-1 (perto do operador, longe
  // do banco) e paga ~120-150ms de latência cross-region em cada round-trip (perf FASE 1.1).
  const { data, error } = await supabase.functions.invoke('platform-admin', {
    body: { action, ...params },
    region: FunctionRegion.UsEast1,
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
