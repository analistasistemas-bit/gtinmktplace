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
}
