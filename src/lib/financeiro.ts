import { supabase } from './supabase';
import type { PeriodoDias } from './metricas';

export interface ResumoFinanceiro {
  bruto: number;
  liquido: number;
  descontos: number;
  estornos: number;
  pagamentos: number;
  /** Secret MP_ACCESS_TOKEN ausente — conta Mercado Pago não conectada. */
  semCredencialMP?: boolean;
  /** Falha ao ler /payments do MP — números não confiáveis. */
  erroFinanceiro?: string;
}

/** Busca o resumo financeiro realizado do período (edge resumo-financeiro). */
export async function buscarResumoFinanceiro(periodoDias: PeriodoDias): Promise<ResumoFinanceiro> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const ate = new Date();
  const desde = new Date(ate.getTime() - periodoDias * 24 * 60 * 60 * 1000);
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resumo-financeiro`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ desde: desde.toISOString(), ate: ate.toISOString() }),
    },
  );
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as ResumoFinanceiro;
}
