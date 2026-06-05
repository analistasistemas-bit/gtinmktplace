export interface PlanilhaRow {
  CODIGO: string;
  PAI: string;
  NOME: string;
  UNIDADE: string;
  GTIN: string | null;
  CUSTO: number;
  PRECO: number;
  ESTOQUE: number;
  DESCRICAO_DETALHADO: string;
  PESO_GRAMAS: number;
  ALTURA_CM: number;
  LARGURA_CM: number;
  COMPRIMENTO_CM: number;
  FORNECEDOR: string;
}

export interface FamiliaAgrupada {
  codigo_pai: string;
  nome_pai: string;
  descricao_pai: string;
  unidade: string;
  fornecedor: string;
  variacoes: PlanilhaRow[];
}

/** Anomalias de dados descartadas no ingest (ADR-0013), todas não-bloqueantes. */
export interface AnomaliasPlanilha {
  codigos_duplicados: string[];
  filhos_orfaos: string[];
  familias_sem_filho: string[];
}

export interface ResultadoAgrupamento {
  grupos: FamiliaAgrupada[];
  anomalias: AnomaliasPlanilha;
}

export const COLUNAS_OBRIGATORIAS = [
  'CODIGO', 'PAI', 'NOME', 'UNIDADE', 'GTIN', 'CUSTO', 'PRECO', 'ESTOQUE',
  'DESCRICAO_DETALHADO', 'PESO_GRAMAS', 'ALTURA_CM', 'LARGURA_CM', 'COMPRIMENTO_CM',
  'FORNECEDOR',
] as const;
