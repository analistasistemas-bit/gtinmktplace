/** Tipos do módulo de exportação (agnóstico de tela). */

export type ExportFormato = 'pdf' | 'excel' | 'csv' | 'imprimir';

export interface ExportConfig {
  formato: ExportFormato;
  /** Incluir o conteúdo expandido (sublinhas). Ignorado se a tela não tem expansão. */
  expandido: boolean;
  /** Incluir o bloco de KPIs. Ignorado se a tela não tem KPIs. */
  incluirKpis: boolean;
}

export interface Kpi {
  label: string;
  /** Valor já formatado como texto (ex.: "R$ 1.234,56", "23,4%"). */
  valor: string;
}

export type Alinhamento = 'left' | 'right' | 'center';

export interface Coluna {
  chave: string;
  titulo: string;
  alinhamento?: Alinhamento;
}

export type Celula = Record<string, string | number | null>;

export interface Sublinhas {
  colunas: Coluna[];
  linhas: Celula[];
}

export interface Linha {
  celulas: Celula;
  /** Conteúdo "expandido" sob a linha-pai (incluído só quando config.expandido). */
  sublinhas?: Sublinhas;
}

/** Bloco-resumo titulado (lista label/valor), ex.: "Top produtos (faturamento)". */
export interface BlocoResumo {
  titulo: string;
  itens: Kpi[];
}

export interface ReportData {
  /** Título do relatório, ex.: "Faturamento · Vendas". */
  titulo: string;
  /** Período já formatado, ex.: "01–30/06/2026". */
  periodo?: string;
  /** Filtros ativos já formatados, ex.: ["Status: ativo", "Fornecedor: ACME"]. */
  filtros?: string[];
  /** Preenchido apenas quando config.incluirKpis. */
  kpis?: Kpi[];
  /** Blocos-resumo extras (listas tituladas), renderizados após os KPIs. Só quando config.incluirKpis. */
  blocos?: BlocoResumo[];
  colunas: Coluna[];
  linhas: Linha[];
}
