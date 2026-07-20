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

export type DashboardMetrica = 'faturamento' | 'liquido' | 'pedidos';
export type DashboardTendencia = 'up' | 'down' | 'neutral';

export interface DashboardKpiVisual {
  label: string;
  valor: string;
  delta?: string;
  tendencia?: DashboardTendencia;
  auxiliar?: string;
}

export interface DashboardPontoVisual {
  rotulo: string;
  valor: number | null;
}

export interface DashboardProdutoVisual {
  posicao: number;
  titulo: string;
  unidades: number;
  faturamento: number;
}

export interface DashboardLiberacaoVisual {
  data: string;
  valor: number;
}

export interface DashboardUfVisual {
  uf: string;
  pedidos: number;
  participacao: number;
}

export interface DashboardPdfVisual {
  tipo: 'dashboard';
  periodo: string;
  canal: string;
  metrica: DashboardMetrica;
  serie: DashboardPontoVisual[];
  principais: [DashboardKpiVisual, DashboardKpiVisual];
  secundarios: [
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
  ];
  alertas: string[];
  produtos: DashboardProdutoVisual[];
  liberacoes: DashboardLiberacaoVisual[];
  totalAReceber: number;
  geografia: DashboardUfVisual[];
  semLocalizacao: number;
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
  dashboardPdf?: DashboardPdfVisual;
  colunas: Coluna[];
  linhas: Linha[];
}
