import { supabase } from './supabase';

export type PeriodoDias = 7 | 30 | 90;

export interface MetricasVendas {
  /** ml_item_id → vendas do período. */
  porItem: Record<string, { unidades: number; valor: number }>;
  totais: { faturamento: number; unidades: number; pedidos: number };
  semCredencialML?: boolean;
  /** Falha ao ler /orders do ML (ex.: app sem permissão de Pedidos) — números não confiáveis. */
  erroVendas?: string;
}

/** Busca as vendas agregadas do período (edge metricas-vendas). desde/ate calculados aqui. */
export async function buscarMetricasVendas(periodoDias: PeriodoDias): Promise<MetricasVendas> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const ate = new Date();
  const desde = new Date(ate.getTime() - periodoDias * 24 * 60 * 60 * 1000);
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/metricas-vendas`,
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
  return json as MetricasVendas;
}
