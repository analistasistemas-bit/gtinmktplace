import { supabase } from './supabase';
import type { Janela } from './metricas';

/** Uma venda (pagamento aprovado) que compõe o líquido do período. */
export interface VendaFinanceira {
  id: string;
  data: string | null;
  /** money_release_date (ISO) — quando o ML libera este recebimento. Passado = liberado;
   *  futuro = a liberar. null quando o MP não informa. */
  dataLiberacao: string | null;
  descricao: string | null;
  bruto: number;
  liquido: number;
  retido: number;
  estorno: number;
  /** Custo total do produto nesta venda (custo unitário × quantidade), em R$. null = sem custo
   *  cadastrado ou venda não mapeada — markup "—". */
  custo: number | null;
  /** Código do produto (planilha) da venda, quando mapeada ao catálogo. null = não mapeada. */
  codigo: string | null;
}

export interface ResumoFinanceiro {
  bruto: number;
  liquido: number;
  descontos: number;
  estornos: number;
  pagamentos: number;
  /** Detalhe por venda (compõe o líquido). Ausente em respostas sem credencial/erro. */
  vendas?: VendaFinanceira[];
  /** Secret MP_ACCESS_TOKEN ausente — conta Mercado Pago não conectada. */
  semCredencialMP?: boolean;
  /** Falha ao ler /payments do MP — números não confiáveis. */
  erroFinanceiro?: string;
}

/** Busca o resumo financeiro realizado do período (edge resumo-financeiro). */
export async function buscarResumoFinanceiro(janela: Janela): Promise<ResumoFinanceiro> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resumo-financeiro`,
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
  if (json == null) throw new Error('Resposta inválida do servidor');
  return json as ResumoFinanceiro;
}
