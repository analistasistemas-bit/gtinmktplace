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

export interface AnaliseMercado {
  preco_max: number | null;
  total_ofertas: number;
  frete_gratis: number;
  full: number;
  lideres: number;
  maior_vendas: number;
  ranking_categoria: number | null;
  produto_desde: string | null;
}

export type TipoAviamento = 'linha' | 'botao' | 'fita' | 'outro';

export type FamiliaStatus =
  | 'pendente'
  | 'processando'
  | 'pronto'
  | 'publicando'
  | 'publicado'
  | 'erro';

/** Anomalias da planilha descartadas no ingest (ADR-0013), todas não-bloqueantes. */
export interface AnomaliasPlanilha {
  codigos_duplicados: string[];
  filhos_orfaos: string[];
  familias_sem_filho: string[];
}

export function parseAnomalias(json: unknown): AnomaliasPlanilha {
  const o = (json ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    codigos_duplicados: arr(o.codigos_duplicados),
    filhos_orfaos: arr(o.filhos_orfaos),
    familias_sem_filho: arr(o.familias_sem_filho),
  };
}

export function totalAnomalias(a: AnomaliasPlanilha): number {
  return a.codigos_duplicados.length + a.filhos_orfaos.length + a.familias_sem_filho.length;
}

export interface MudancaEstrutural {
  novas: string[];
  removidas: { codigo: string; cor: string | null }[];
}

export function parseMudancaEstrutural(json: unknown): MudancaEstrutural | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const novas = Array.isArray(o.novas) ? o.novas.map(String) : [];
  const removidas = Array.isArray(o.removidas)
    ? o.removidas.map((r) => {
        const x = (r ?? {}) as Record<string, unknown>;
        return { codigo: String(x.codigo ?? ''), cor: x.cor != null ? String(x.cor) : null };
      })
    : [];
  if (novas.length === 0 && removidas.length === 0) return null;
  return { novas, removidas };
}

export interface Lote {
  id: string;
  numero: number;
  criadoEm: string; // ISO 8601
  status: LoteStatus;
  totalFamilias: number;
  totalPublicadas: number;
  totalErros: number;
  anomalias: AnomaliasPlanilha;
}

export type CorOrigem = 'descricao' | 'vision' | 'manual';

export interface Variacao {
  id?: string;
  codigo: string;
  cor: string;
  corHex: string;
  corOrigem: CorOrigem | null;
  corEditadaPeloOperador: boolean;
  preco: number;
  precoPublicacao: number | null;
  estoque: number;
  gtin: string | null;
  fotoPath?: string;
  editadoPeloOperador?: boolean;
  excluidaDaPublicacao: boolean;
  mlVariationId: string | null;
  estoqueAnterior: number | null;
  custo: number | null;
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
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
  concorrenciaVendedores: number;
  concorrenciaPrecoMin: number | null;
  analiseMercado: AnaliseMercado | null;
  tipoAviamento: TipoAviamento | null;
  categoriaMlId: string | null;
  precoMin: number;
  precoMax: number;
  precoAbaixo20pc: boolean;
  fotoCapaPath?: string;
  capaStoragePath: string | null;
  capa2StoragePath: string | null;
  capa3StoragePath: string | null;
  variacaoPrincipalCodigo: string | null;
  variacoes: Variacao[];
  editadoPeloOperador?: boolean;
  status: FamiliaStatus;
  tokensInput: number | null;
  tokensOutput: number | null;
  custoCentavos: number | null;
  tituloEditadoPeloOperador: boolean;
  descricaoEditadaPeloOperador: boolean;
  variacoesSemCor: number;
  mlPermalink: string | null;
  mlItemId: string | null;
  mudancaEstrutural: MudancaEstrutural | null;
  erroMensagem: string | null;
  exibirComDesconto: boolean;
  descontoPct: number | null;
}
