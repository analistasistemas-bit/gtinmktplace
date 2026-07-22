// supabase/functions/_shared/canais/contrato.ts
// E6 (ADR-0061): os tipos canônicos do payload são donos AQUI (o contrato), não em
// ml/*. Os módulos ML re-exportam para não quebrar imports existentes (inversão de
// dependência: o canal genérico não depende do ML).

/** Atributo de item no formato canônico (id + valor por nome ou id). */
export interface AtributoItem { id: string; value_name?: string; value_id?: string; }

/** Dimensões/peso da embalagem para frete (ADR-0018): cm e gramas. */
export interface DimensoesPacote {
  altura_cm: number | null;
  largura_cm: number | null;
  comprimento_cm: number | null;
  peso_gramas: number | null;
}

/** Faixa de preço por quantidade / atacado (ADR-0041). */
export interface FaixaAtacado {
  min_unidades: number;
  desconto_pct: number;
}

/** Canais suportados. Expandir conforme novos adapters (ADR-0024). */
export type CanalId = 'mercado_livre';

/** Recursos que variam por canal; a orquestração consulta antes de agir. */
export interface Capabilities {
  variacoes: boolean;        // suporta variações sob 1 anúncio
  descricaoSeparada: boolean; // descrição é recurso à parte (ML=true)
  catalogo: boolean;          // opt-in de catálogo/buybox (ML=true)
  desconto: boolean;
  atacado: boolean;          // preço por quantidade (PxQ B2B)
  dimensoesPacote: boolean;
}

/** Taxonomia de erro unificada (generaliza humanizarErroML/ehErroRetentavel). */
export type ErroCanalCodigo =
  | 'TITULO' | 'FOTO' | 'PRECO' | 'GTIN' | 'ATRIBUTO' | 'VARIACAO'
  | 'CATEGORIA' | 'DESCRICAO' | 'ESTOQUE' | 'AUTENTICACAO'
  | 'RATE_LIMIT' | 'INDISPONIVEL' | 'NAO_SUPORTADO' | 'DESCONHECIDO'
  // ADR-0088: categoria UP (item plano/family_name) com >1 cor — o conector recusa e a
  // orquestração roteia para a saga que cria N itens separados (um por SKU). Não é erro do ML.
  | 'FORMATO_INCOMPATIVEL';

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
  /** Modo de exposição do anúncio no canal (ML: gold_special/gold_pro). null se indisponível. */
  listingType: 'classico' | 'premium' | null;
}

/** Atualização de um anúncio já publicado (UPDATE), no modelo canônico. */
export interface AtualizacaoCanonica {
  itemExternoId: string;
  /** Cores já vinculadas (repor estoque): sku + estoque desejado + cor atual no banco
   *  (p/ reenviar COLOR ao ML quando o nome da cor muda — ADR-0062). */
  existentes: Array<{ sku: string; estoque: number; cor: string | null }>;
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
  /** Modo reposição pura: não empurra preço por nenhum ramo; cor nova entra no preço vivo. ADR-0078 F1. */
  somenteEstoque?: boolean;
}

/** Resultado do UPDATE: sku → id externo da variação (casar/persistir + detectar não-vinculadas). */
export interface ResultadoAtualizacao {
  variacoesExternas: Record<string, string>;
  /** Preço vivo do anúncio (do GET pré-PUT), p/ o worker gravar preco_publicado_ml em "só estoque"
   *  sem um 2º GET (ADR-0078 F1). null quando nenhuma variação viva tinha price. */
  precoVivo: number | null;
}

/** Um item que vendeu mas está fora do escopo do app (publicado direto no canal). */
export interface ItemExternoVenda {
  id: string;
  titulo: string;
  unidades: number;
  valor: number;
}

/** Métricas de venda de um período, no modelo canônico (multicanal). */
export interface MetricasVendasCanal {
  /** itemExternoId → vendas do período (só itens dentro do escopo consultado). */
  porItem: Record<string, { unidades: number; valor: number }>;
  /** Totais de TODA a conta do vendedor no período — inclui anúncios fora do escopo (ADR-0032). */
  totais: { faturamento: number; unidades: number; pedidos: number };
  /** Itens fora do escopo do app que venderam no período (compõem o total — detalhe de vendas). */
  externos?: ItemExternoVenda[];
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
  /** Aplica preço de atacado (PxQ B2B) no item já criado. faixas vazio = limpa. Lança em falha. */
  aplicarAtacado(ctx: ContextoCanal, itemExternoId: string, precoBase: number, faixas: FaixaAtacado[]): Promise<void>;
  /** Atualiza um anúncio existente (estoque / cores novas / preço / atributos). Não lança: erros viram ResultadoCanal.erro. */
  atualizarAnuncio(ctx: ContextoCanal, a: AtualizacaoCanonica): Promise<ResultadoCanal<ResultadoAtualizacao>>;
  /** Sincroniza a descrição ao vivo (resolve + push). Retorna a descrição a persistir, ou null se nada mudou. */
  sincronizarDescricao(ctx: ContextoCanal, itemExternoId: string, descricaoAtual: string, cores: string[]): Promise<string | null>;
  /** Lê o status de N anúncios em lote. Lança se o token falhar (sem credencial). */
  lerStatus(ctx: ContextoCanal, itemExternoIds: string[]): Promise<Record<string, StatusCanal>>;
  /** Pausa/reativa o anúncio (ADR-0060). Não lança: erros viram ResultadoCanal.erro. */
  atualizarStatus(ctx: ContextoCanal, itemExternoId: string, status: 'ativo' | 'pausado'): Promise<ResultadoCanal<void>>;
  /**
   * Agrega vendas do período (limites inclusive, ISO 8601). `totais` cobrem toda a conta do
   * vendedor; `porItem` fica restrito aos itens do escopo (anúncios gerenciados pelo app).
   * Lança se o token falhar (sem credencial); erros de leitura de página devolvem parcial.
   */
  lerMetricasVendas(
    ctx: ContextoCanal,
    intervalo: { desde: string; ate: string },
    itemExternoIds: string[],
    mapaGtin?: Record<string, string>,
  ): Promise<MetricasVendasCanal>;
}
