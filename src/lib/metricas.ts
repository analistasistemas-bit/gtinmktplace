import { supabase } from './supabase';

export type PeriodoDias = 7 | 30 | 90;

/** Período selecionado: preset (7/30/90) ou intervalo de datas livre (YYYY-MM-DD). */
export type Periodo =
  | { tipo: 'preset'; dias: PeriodoDias }
  | { tipo: 'range'; desde: string; ate: string };

/** Janela resolvida em ISO 8601 (limites inclusive) para enviar à edge function. */
export interface Janela { desde: string; ate: string }

export interface ItemExternoVenda { id: string; titulo: string; unidades: number; valor: number }

export interface MetricasVendas {
  /** ml_item_id → vendas do período (anúncios do app). */
  porItem: Record<string, { unidades: number; valor: number }>;
  totais: { faturamento: number; unidades: number; pedidos: number };
  /** Itens fora do PubliAI que venderam no período (compõem o total). */
  externos?: ItemExternoVenda[];
  semCredencialML?: boolean;
  /** Falha ao ler /orders do ML (ex.: app sem permissão de Pedidos) — números não confiáveis. */
  erroVendas?: string;
}

/** Calcula a janela ISO a partir do período (preset → agora−dias…agora; range → dia inteiro). */
export function resolverJanela(p: Periodo): Janela {
  if (p.tipo === 'preset') {
    const ate = new Date();
    const desde = new Date(ate.getTime() - p.dias * 24 * 60 * 60 * 1000);
    return { desde: desde.toISOString(), ate: ate.toISOString() };
  }
  const desde = new Date(`${p.desde}T00:00:00`);
  const ate = new Date(`${p.ate}T23:59:59.999`);
  return { desde: desde.toISOString(), ate: ate.toISOString() };
}

/** Serializa o período para query string (?dias=30 ou ?de=…&ate=…). */
export function periodoToParams(p: Periodo): Record<string, string> {
  return p.tipo === 'preset' ? { dias: String(p.dias) } : { de: p.desde, ate: p.ate };
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lê o período de uma fonte de params (ex.: URLSearchParams.get). Default 30 dias. */
export function periodoFromParams(get: (k: string) => string | null): Periodo {
  const de = get('de');
  const ate = get('ate');
  if (de && ate && DATA_RE.test(de) && DATA_RE.test(ate) && de <= ate) {
    return { tipo: 'range', desde: de, ate };
  }
  const dias = Number(get('dias'));
  if (dias === 7 || dias === 30 || dias === 90) return { tipo: 'preset', dias };
  return { tipo: 'preset', dias: 30 };
}

/** Busca as vendas agregadas da janela (edge metricas-vendas). */
export async function buscarMetricasVendas(janela: Janela): Promise<MetricasVendas> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/metricas-vendas`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ desde: janela.desde, ate: janela.ate }),
    },
  );
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as MetricasVendas;
}
