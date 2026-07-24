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

export type TipoAviamento = 'linha' | 'botao' | 'fita' | 'cola' | 'cursor' | 'outro';

// Origem da resolução de categoria (ADR-0026 / E3). regex/manual = alta confiança;
// preditor = média (domain_discovery do ML); ia = baixa (desempate LLM);
// generico = "Outros" aplicado como fallback visível, busque uma melhor (ADR-0058).
export type TipoOrigem = 'regex' | 'preditor' | 'ia' | 'manual' | 'generico';

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

import type { FaixaAtacado } from './atacado';

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
  precoPublicadoMl: number | null;
  estoque: number;
  gtin: string | null;
  fotoPath?: string;
  editadoPeloOperador?: boolean;
  excluidaDaPublicacao: boolean;
  mlVariationId: string | null;
  /** ADR-0088 Fase 2: SKU ativo em `anuncios_externos_itens` (família User Products, cada cor = item
   *  ML próprio → mlVariationId é sempre null). "Casada com o ML" no caso UP vem daqui, não do
   *  mlVariationId. undefined em família Legacy (sinal não se aplica). Resolvido em variacaoFromRow. */
  jaCasadaUP?: boolean;
  estoqueAnterior: number | null;
  custo: number | null;
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
  /** Config por faixa (ADR-0078 F2). null = herda o família-level. */
  exibirComDesconto: boolean | null;
  descontoPct: number | null;
  /** null = herda; [] = explicitamente sem atacado (≠ null!). */
  atacado: FaixaAtacado[] | null;
}

export interface AtributoMl {
  id: string;
  value_id: string | null;
  value_name: string | null;
}

// Atributo obrigatório faltante, com a forma editável (Camada 2B). Espelha CampoFaltante do backend.
export interface CampoFaltante {
  id: string;
  nome: string;
  tipo: 'closed' | 'numero' | 'texto';
  valores: { id: string; nome: string }[];
  unidades?: { id: string; nome: string }[];
}

export interface CategoriaCandidata {
  categoriaId: string;
  categoriaNome: string;
  domainName: string;
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
  /** Preço reancorado no piso dos MercadoLíderes por prejuízo no competitivo (ADR-0065). */
  precoReancoradoLider: boolean;
  concorrencia: Concorrencia;
  concorrenciaVendedores: number;
  concorrenciaPrecoMin: number | null;
  analiseMercado: AnaliseMercado | null;
  tipoAviamento: TipoAviamento | null;
  categoriaMlId: string | null;
  /** Formato confirmado pelo ML; null enquanto a categoria ainda não foi observada. */
  formatoPublicacaoMl: 'legacy' | 'user_products' | null;
  categoriaNome: string | null;
  tipoOrigem: TipoOrigem | null;
  /** category_id do concorrente (ADR-0057) — sugestão não-vinculante no seletor de categoria. */
  concorrenciaCategoriaId: string | null;
  /** Origem do produto p/ imposto (ADR-0055): nacional | importado. */
  origem: 'nacional' | 'importado';
  atributosFaltantes: string[] | null;
  atributosMl: AtributoMl[];
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
  /** Anúncios publicados do produto (split ADR-0048): 1 no caso normal, N quando >100 cores.
   *  Ordenado por partição (0 = principal). Vazio = sem espelho em anuncios_externos. */
  anuncios: { particao: number; permalink: string | null; titulo: string | null }[];
  mudancaEstrutural: MudancaEstrutural | null;
  erroMensagem: string | null;
  exibirComDesconto: boolean;
  descontoPct: number | null;
  atacado: FaixaAtacado[] | null;
  atacadoStatus: string | null;
  atacadoErro: string | null;
  /** ADR-0088 F2: falha ao sincronizar a lista de cores na descrição de família User Products
   *  (mesmo padrão do atacado — agregado, não por-item). null/undefined = sem falha conhecida. */
  descricaoStatus?: string | null;
  descricaoErro?: string | null;
}
