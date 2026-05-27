export interface PlanilhaRow {
  CODIGO: string;
  PAI: string;
  NOME: string;
  UNIDADE: string;
  GTIN: string | null;
  PRECO: number;
  ESTOQUE: number;
  DESCRICAO_DETALHADO: string;
  PESO_GRAMAS: number;
  ALTURA_CM: number;
  LARGURA_CM: number;
  COMPRIMENTO_CM: number;
}

export interface FamiliaAgrupada {
  codigo_pai: string;
  nome_pai: string;
  descricao_pai: string;
  unidade: string;
  variacoes: PlanilhaRow[];
}

export const COLUNAS_OBRIGATORIAS = [
  'CODIGO', 'PAI', 'NOME', 'UNIDADE', 'GTIN', 'PRECO', 'ESTOQUE',
  'DESCRICAO_DETALHADO', 'PESO_GRAMAS', 'ALTURA_CM', 'LARGURA_CM', 'COMPRIMENTO_CM',
] as const;
