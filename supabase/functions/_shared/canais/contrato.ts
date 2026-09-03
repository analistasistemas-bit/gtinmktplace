// supabase/functions/_shared/canais/contrato.ts
// E6 (ADR-0061): os tipos canônicos do payload são donos AQUI (o contrato), não em
// ml/*. Os módulos ML re-exportam para não quebrar imports existentes (inversão de
// dependência: o canal genérico não depende do ML).

/** Atributo de item no formato canônico: catálogo por id ou personalizado por name. */
export interface AtributoItem {
  id?: string;
  name?: string;
  value_name?: string;
  value_id?: string;
}

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

/** Estoque absoluto desejado para um SKU dentro de um anúncio (E6b, ADR-0054). */
export interface EstoquePorSku { sku: string; estoque: number }

/** Recursos que variam por canal; a orquestração consulta antes de agir. */
export interface Capabilities {
  variacoes: boolean;        // suporta variações sob 1 anúncio
  descricaoSeparada: boolean; // descrição é recurso à parte (ML=true)
  catalogo: boolean;          // opt-in de catálogo/buybox (ML=true)
  desconto: boolean;
  atacado: boolean;          // preço por quantidade (PxQ B2B)
  dimensoesPacote: boolean;
  atualizarEstoque: boolean; // push barato de estoque, sem o pipeline de UPDATE completo
}

/** Taxonomia de erro unificada (generaliza humanizarErroML/ehErroRetentavel). */
export type ErroCanalCodigo =
  | 'TITULO' | 'FOTO' | 'PRECO' | 'GTIN' | 'ATRIBUTO' | 'VARIACAO'
  | 'CATEGORIA' | 'DESCRICAO' | 'ESTOQUE' | 'AUTENTICACAO'
  | 'RATE_LIMIT' | 'INDISPONIVEL' | 'NAO_SUPORTADO' | 'DESCONHECIDO'
  // ADR-0088: categoria UP (item plano/family_name) com >1 cor — o conector recusa e a
  // orquestração roteia para a saga que cria N itens separados (um por SKU). Não é erro do ML.
  | 'FORMATO_INCOMPATIVEL'
  // ADR-0104: no UPDATE, o GET ao vivo revelou que o ML migrou uma família JÁ PUBLICADA para
  // User Products (item plano + family_name) e ela tem mais de uma cor. Não é erro do ML nem do
  // operador: a orquestração adota os itens irmãos por SKU e roteia para a saga UP.
  | 'MIGRADO_PARA_UP'
  | 'DESCONTO_INCOMPATIVEL';

export interface ErroCanal {
  codigo: ErroCanalCodigo;
  mensagemOperador: string;
  retentavel: boolean;
  /** HTTP status nativo, quando houver — o worker decide retry (5xx/429) sem garimpar `raw`. */
  status?: number;
  raw?: unknown;
  /** ADR-0104: só em `MIGRADO_PARA_UP` — o que o GET ao vivo observou no item migrado. A
   *  orquestração precisa disto para buscar os irmãos (family_name é critério da busca por SKU)
   *  e para validar o vendedor. */
  up?: {
    familyId: string | null;
    familyName: string | null;
    sellerId: string | null;
    /** ADR-0105: presente quando o item Legacy foi DISSOLVIDO (fechado) em vez de convertido. Não
     *  há family_id/family_name no item morto — a orquestração descobre a família nova pelo título
     *  e casa as cores. `motivoFallback` é a mensagem original do guard de anúncio morto, lançada
     *  intacta se a descoberta não achar nada (anúncio de fato encerrado). */
    dissolvido?: {
      titulo: string | null;
      categoriaId: string | null;
      /** sku (seller_custom_field) → COLOR.value_name, lidos das variações do item morto. */
      corPorSku: Record<string, string>;
      motivoFallback: string;
    };
  };
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
  /** GTIN da unidade-base, só para kit vinculado (ADR-0151 D-5 revisada). NÃO entra no payload
   *  normal: é o fallback usado apenas se o canal recusar o item por GTIN obrigatório — em
   *  categorias que exigem o código, o ML modela pack como GTIN da unidade + UNITS_PER_PACK
   *  (tag `pack_multiplier` no schema). Ausente em produto comum. */
  gtinPackFallback?: string | null;
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
  /** ML: tag `catalog_forewarning` no item — o próprio canal sinaliza "prestes a ser pausado"
   *  por falta de ficha de catálogo (fonte real, substitui a inferência local). Canal sem essa
   *  noção → false. */
  catalogForewarning: boolean;
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
  /** Fluxo "Adicionar variação" (tela Estoque): só a cor NOVA vai ao canal. As já publicadas
   *  entram no payload apenas para o ML não apagá-las (o PUT de variations deleta as omitidas),
   *  com o estoque que já está lá — sem cor, sem preço, sem foto. Pedido do Diego 2026-09-03,
   *  depois de um PUT inteiro ser recusado com "You cannot change attribute combinations if the
   *  variation has bids" ao adicionar uma cor. */
  preservarPublicadas?: boolean;
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
  /**
   * Push de estoque por VALOR ABSOLUTO para um anúncio já publicado (E6b, ADR-0094).
   * `estoques` cobre apenas os SKUs que vivem neste item externo — quem resolve isso
   * é o worker, que conhece split (ADR-0048) e user products (ADR-0088).
   * Não lança: erros viram ResultadoCanal.erro.
   */
  atualizarEstoque(
    ctx: ContextoCanal,
    itemExternoId: string,
    estoques: EstoquePorSku[],
  ): Promise<ResultadoCanal<void>>;
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
