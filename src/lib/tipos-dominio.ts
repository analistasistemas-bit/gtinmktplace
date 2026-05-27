export type LoteStatus =
  | 'importando'
  | 'processando'
  | 'revisao'
  | 'publicando'
  | 'concluido'
  | 'erro';

export type OperacaoML = 'CREATE' | 'UPDATE';

export type EstrategiaPreco = 'PROPRIO' | 'COMPETITIVO';

export type Concorrencia = 'sem' | 'moderada' | 'alta';

export type FamiliaStatus =
  | 'pendente'
  | 'processando'
  | 'pronto'
  | 'publicando'
  | 'publicado'
  | 'erro';

export interface Lote {
  id: string;
  numero: number;
  criadoEm: string; // ISO 8601
  status: LoteStatus;
  totalFamilias: number;
  totalPublicadas: number;
  totalErros: number;
}

export interface Variacao {
  codigo: string;
  cor: string;
  corHex: string;
  preco: number;
  estoque: number;
  fotoUrl?: string;
  editadoPeloOperador?: boolean;
}

export interface Familia {
  id: string;
  loteId: string;
  codigoPai: string;
  titulo: string;
  descricao: string;
  operacao: OperacaoML;
  estrategiaPreco: EstrategiaPreco;
  estrategiaMotivo: string;
  concorrencia: Concorrencia;
  precoMin: number;
  precoMax: number;
  precoAbaixo20pc: boolean;
  fotoCapaUrl?: string;
  variacoes: Variacao[];
  editadoPeloOperador?: boolean;
  status: FamiliaStatus;
}
