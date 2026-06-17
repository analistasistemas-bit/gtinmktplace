// supabase/functions/_shared/canais/contrato.ts
import type { AtributoItem } from '../ml/publicar.ts';
import type { DimensoesPacote } from '../ml/pacote.ts';

/** Canais suportados. Expandir conforme novos adapters (ADR-0024). */
export type CanalId = 'mercado_livre';

/** Recursos que variam por canal; a orquestração consulta antes de agir. */
export interface Capabilities {
  variacoes: boolean;        // suporta variações sob 1 anúncio
  descricaoSeparada: boolean; // descrição é recurso à parte (ML=true)
  catalogo: boolean;          // opt-in de catálogo/buybox (ML=true)
  desconto: boolean;
  dimensoesPacote: boolean;
}

/** Taxonomia de erro unificada (generaliza humanizarErroML/ehErroRetentavel). */
export type ErroCanalCodigo =
  | 'TITULO' | 'FOTO' | 'PRECO' | 'GTIN' | 'ATRIBUTO' | 'VARIACAO'
  | 'CATEGORIA' | 'DESCRICAO' | 'ESTOQUE' | 'AUTENTICACAO'
  | 'RATE_LIMIT' | 'INDISPONIVEL' | 'NAO_SUPORTADO' | 'DESCONHECIDO';

export interface ErroCanal {
  codigo: ErroCanalCodigo;
  mensagemOperador: string;
  retentavel: boolean;
  /** HTTP status nativo, quando houver — o worker decide retry (5xx/429) sem garimpar `raw`. */
  status?: number;
  raw?: unknown;
}

export interface ResultadoCanal<T> {
  ok: boolean;
  valor?: T;
  erro?: ErroCanal;
}

/** Referência do anúncio criado no canal. */
export interface RefAnuncio {
  itemExternoId: string;
  permalink?: string;
  /** sku interno (codigo) → id da variação no canal. */
  variacoesExternas: Record<string, string>;
}

/** Uma variação no modelo canônico (CREATE). fotoId já é o id no canal. */
export interface VariacaoCanonica {
  sku: string;
  cor: string | null;
  estoque: number;
  preco: number | null;
  gtin: string | null;
  fotoId: string | null;
}

/**
 * Anúncio no modelo canônico (CREATE). Nesta fatia, `categoriaId`/`atributos`
 * ainda vêm no formato do canal (categoria_ml_id + atributos_ml montados); a
 * canonicalização de categoria/atributos é o E3.
 */
export interface AnuncioCanonico {
  titulo: string | null;
  descricao: string | null;
  categoriaId: string | null;
  atributos: AtributoItem[];
  capaFotoId: string | null;
  capa2FotoId: string | null;
  capa3FotoId: string | null;
  listingTypeId?: string;
  desconto: { pct: number } | null;
  dimensoes: DimensoesPacote | null;
  variacoes: VariacaoCanonica[];
}

/** Status do anúncio no modelo canônico (generaliza StatusParsed de ml/status). */
export type StatusAnuncioCanal =
  | 'ativo' | 'pausado' | 'encerrado' | 'moderado' | 'inativo' | 'indisponivel';
export interface StatusCanal {
  status: StatusAnuncioCanal;
  motivo: string | null;
  estoque: number | null;
  preco: number | null;
}

/** Atualização de um anúncio já publicado (UPDATE), no modelo canônico. */
export interface AtualizacaoCanonica {
  itemExternoId: string;
  /** Cores já vinculadas (repor estoque): sku → estoque desejado. */
  existentes: Array<{ sku: string; estoque: number }>;
  /** Cores novas a criar como variação. */
  novas: VariacaoCanonica[];
  capaFotoId: string | null;
  capa2FotoId: string | null;
  capa3FotoId: string | null;
  categoriaId: string | null;
  /** BRAND a sincronizar (do fornecedor). null → não envia (preserva o atual). */
  marca: string | null;
  dimensoes: DimensoesPacote | null;
  /** Desconto ativo → price+original_price por código. */
  desconto: { pct: number; precoPorCodigo: Record<string, number | null> } | null;
  /** Preço de publicação da família, propagado a TODAS as variações (adendo ADR-0016). */
  precoFamilia: number | null;
}

/** Resultado do UPDATE: sku → id externo da variação (casar/persistir + detectar não-vinculadas). */
export interface ResultadoAtualizacao {
  variacoesExternas: Record<string, string>;
}

/** Métricas de venda de um período, no modelo canônico (multicanal). */
export interface MetricasVendasCanal {
  /** itemExternoId → vendas do período (só itens dentro do escopo consultado). */
  porItem: Record<string, { unidades: number; valor: number }>;
  totais: { faturamento: number; unidades: number; pedidos: number };
}

/** Contexto por chamada (auth lazy). */
export interface ContextoCanal {
  getToken(): Promise<string>;
}

export interface ChannelConnector {
  readonly id: CanalId;
  readonly capabilities: Capabilities;
  /** Sobe uma foto (a partir de URL assinada) e devolve o id da foto no canal. Lança em falha. */
  subirFoto(ctx: ContextoCanal, sourceUrl: string): Promise<string>;
  /** Cria o anúncio. Não lança: erros viram ResultadoCanal.erro. */
  criarAnuncio(ctx: ContextoCanal, anuncio: AnuncioCanonico): Promise<ResultadoCanal<RefAnuncio>>;
  /** Garante a descrição (recurso separado). Best-effort no worker. */
  garantirDescricao(ctx: ContextoCanal, itemExternoId: string, descricao: string): Promise<void>;
  /** Atualiza um anúncio existente (estoque / cores novas / preço / atributos). Não lança: erros viram ResultadoCanal.erro. */
  atualizarAnuncio(ctx: ContextoCanal, a: AtualizacaoCanonica): Promise<ResultadoCanal<ResultadoAtualizacao>>;
  /** Sincroniza a descrição ao vivo (resolve + push). Retorna a descrição a persistir, ou null se nada mudou. */
  sincronizarDescricao(ctx: ContextoCanal, itemExternoId: string, descricaoAtual: string, cores: string[]): Promise<string | null>;
  /** Lê o status de N anúncios em lote. Lança se o token falhar (sem credencial). */
  lerStatus(ctx: ContextoCanal, itemExternoIds: string[]): Promise<Record<string, StatusCanal>>;
  /**
   * Agrega vendas do período (limites inclusive, ISO 8601), restrito aos itens do escopo
   * (anúncios gerenciados pelo app). Lança se o token falhar (sem credencial); erros de
   * leitura de página devolvem agregado parcial.
   */
  lerMetricasVendas(
    ctx: ContextoCanal,
    intervalo: { desde: string; ate: string },
    itemExternoIds: string[],
  ): Promise<MetricasVendasCanal>;
}
