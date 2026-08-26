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
  ORIGEM?: string;
  // ADR-0135: fiscais, só exigidos (via exigirFiscalExplicito) na org com módulo fiscal.
  NCM?: string;
  CEST?: string;
  ORIGEM_NFE?: string;
  CSOSN?: string;
}

export interface FamiliaAgrupada {
  codigo_pai: string;
  nome_pai: string;
  descricao_pai: string;
  unidade: string;
  fornecedor: string;
  origem: 'nacional' | 'importado';
  ncm?: string | null;
  cest?: string | null;
  origem_nfe?: number | null;
  tributacao_icms?: string | null;
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
  // ORIGEM define a alíquota de imposto (8% nacional / 16% importado). Obrigatória desde o
  // ADR-0107: sem a coluna, o lote inteiro caía em 'nacional' em silêncio.
  'ORIGEM',
] as const;
