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
    texto: string; anexos: Array<{ id: string; nome: string }>; status: string | null; moderacao: string | null;
  }>;
  acoes: string[];
  revisoes: Array<{ order_id: number; seller_status: string | null }>;
  pedidos_devolucao: number[];
  motivos_falha_revisao: Array<{ id: string; texto: string; exige_foto: boolean; aplica: string[] }>;
  reembolso_parcial: { ofertas: Array<{ percentual: number; valor: number }>; minimo: number | null } | null;
  /** Leituras informativas que falharam (o campo correspondente vem null/vazio). */
  incompleto: string[];
}

export type AcaoPosvenda =
  | 'revisar_ok' | 'revisar_falha' | 'responder' | 'reembolsar' | 'reembolso_parcial'
  | 'autorizar_devolucao' | 'abrir_disputa';

export type EstadoAcaoPosvenda =
  | 'reservada' | 'enviada' | 'confirmada' | 'recusada' | 'desconhecido' | 'inconclusiva' | 'cancelada';

/** Espelho de `BodyAcao` (posvenda-fluxo.ts). `operacao_id` é gerado ao ABRIR o diálogo e reusado em
 *  qualquer repetição/"Conferir" — é ele que impede o segundo POST. */
export interface BodyAcaoPosvenda {
  operacao_id: string;
  claim_id: string;
  acao: AcaoPosvenda;
  texto?: string;
  percentual?: number;
  revisoes?: Array<{ order_id?: number; motivo_id: string; texto: string; anexos: string[] }>;
  anexos?: string[];
}

export interface ResultadoAcaoPosvenda {
  ok: true;
  estado: EstadoAcaoPosvenda;
  operacao_id: string;
  /** true = o ML ainda não confirmou (mostrar "Conferir no ML"); a trava segue no item. */
  pendenteConfirmacao: boolean;
  sincronizacaoPendente: boolean;
  devolucao: Record<string, unknown> | null;
}

/** Executa a ação no ML. Erros (`ok:false`) viram Error com `codigo`: `em_andamento`, `recusada`,
 *  `cancelada`, `reconectar`, `moderacao`. */
export function executarAcaoPosvenda(body: BodyAcaoPosvenda): Promise<ResultadoAcaoPosvenda> {
  return postEdge<ResultadoAcaoPosvenda>('posvenda-acao', body);
}

/** Só relê o ML para a tentativa já registrada; nunca envia de novo. */
export function verificarAcaoPosvenda(operacaoId: string, claimId: string): Promise<ResultadoAcaoPosvenda> {
  return postEdge<ResultadoAcaoPosvenda>('posvenda-acao', { operacao_id: operacaoId, claim_id: claimId, verificar: true });
}

/** Estado da reclamação relido do ML agora (nunca do cache local). */
export async function buscarDetalheReclamacao(claimId: string): Promise<DetalheReclamacao> {
  const r = await postEdge<{ ok: true; detalhe: DetalheReclamacao }>('posvenda-detalhe', { claim_id: claimId });
  return r.detalhe;
}
