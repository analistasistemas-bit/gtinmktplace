import { postEdge } from './edge';

/** Espelho de `DetalheReclamacao` em supabase/functions/_shared/faturamento/posvenda.ts. */
export interface DetalheReclamacao {
  claim_id: number;
  return_id: number | null;
  stage: string | null;
  status: string | null;
  estado: {
    titulo: string | null; descricao: string | null; problema: string | null;
    prazo: string | null; vez_de: 'vendedor' | 'comprador' | 'ml' | null;
  };
  comprador_quer: string | null;
  resolucoes: Array<{
    papel: string; tipo: string; status: string;
    detalhes: Array<{ chave: string; valor: string }>;
    criada_em: string; atualizada_em: string;
  }>;
  resolucao_final: { motivo: string | null; data: string | null } | null;
  afeta_reputacao: string | null;
  custo_devolucao: number | null;
  historico: Array<{
    data: string; autor: 'comprador' | 'vendedor' | 'ml'; destinatario: 'comprador' | 'vendedor' | 'ml' | null;
    texto: string; anexos: string[]; status: string | null; moderacao: string | null;
  }>;
  acoes: string[];
  revisoes: Array<{ order_id: number; seller_status: string | null }>;
  pedidos_devolucao: number[];
  motivos_falha_revisao: Array<{ id: string; texto: string; exige_foto: boolean; aplica: string[] }>;
  reembolso_parcial: { ofertas: Array<{ percentual: number; valor: number }>; minimo: number | null } | null;
}

/** Estado da reclamação relido do ML agora (nunca do cache local). */
export async function buscarDetalheReclamacao(claimId: string): Promise<DetalheReclamacao> {
  const r = await postEdge<{ ok: true; detalhe: DetalheReclamacao }>('posvenda-detalhe', { claim_id: claimId });
  return r.detalhe;
}
