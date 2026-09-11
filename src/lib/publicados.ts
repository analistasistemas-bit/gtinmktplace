import type { TipoAviamento } from './tipos-dominio';

export type StatusPublicado =
  | 'ativo'
  | 'pausado'
  | 'encerrado'
  | 'moderado'
  | 'inativo'
  | 'indisponivel';

export interface PublicadoItem {
  familiaId: string;
  codigoPai: string;
  /** EAN/GTIN representativo do anúncio (variação principal, ou a 1ª publicável). null se ausente. */
  gtin: string | null;
  /** Códigos e GTINs de todas as variações incluídas — a busca casa por qualquer um deles. */
  identificadores?: string[];
  titulo: string;
  fornecedor: string | null;
  /** Tipo interno (enum de aviamento). Grosso: tudo fora dos 4 aviamentos é 'outro'. */
  tipo: TipoAviamento | null;
  /** Categoria-folha real do ML resolvida pela IA/preditor (ex.: "Alfinetes de Segurança"). */
  categoria: string | null;
  precoPublicacao: number;
  /**
   * ADR-0160 — maior preço entre as cores incluídas. Igual a `precoPublicacao` quando uniforme.
   *
   * `precoPublicacao` é o MENOR preço, e sozinho ele mente numa família com preço por variação:
   * a tela anunciava "R$ 19,90" para um produto cuja cor mais cara sai por R$ 34,50. Com os dois
   * campos a coluna mostra a faixa, e a ordenação segue pelo menor (comportamento anterior).
   */
  precoPublicacaoMax: number;
  descricao: string | null;
  mlItemId: string;
  mlPermalink: string | null;
  publicadoEm: string | null;
  // preenchidos pelo status ao vivo (merge no hook):
  /** Canal do anúncio (E6/ADR-0061). Vem do status ao vivo; sem ele, assume 'mercado_livre'. */
  canal?: string;
  status?: StatusPublicado;
  estoque?: number | null;
  precoAtual?: number | null;
  motivo?: string | null;
  /** Modo do anúncio no ML (ao vivo): 'classico' (gold_special) / 'premium' (gold_pro). null se indisponível. */
  listingType?: 'classico' | 'premium' | null;
  // preenchidos pelas métricas de venda do período (merge por mlItemId):
  unidadesVendidas?: number | null;
  valorVendido?: number | null;
  /** Quantidade de variações publicadas neste anúncio (excluídas da publicação não contam). */
  qtdVariacoes?: number;
  /** ADR-0151: TODAS as linhas de `variacoes` da família (excluídas da publicação incluídas) —
   *  o mesmo sinal que `criar-kit-vinculado` usa pra `base_multivariacao` (D-10). Não confundir
   *  com `qtdVariacoes` (só as publicadas no ML): o gating de "Criar kit" precisa do total. */
  qtdVariacoesFamilia?: number;
  /** Alguma variação/item publicado sem vínculo de catálogo num estado que o botão ↻ reavalia:
   *  `erro`, `nao_elegivel`, `sem_produto` ou `pendente` (ver STATUS_CATALOGO_RETENTAVEL). */
  catalogRetentavel?: boolean;
  /** Prontidão de emissão do ML (ADR-0135 D-10) — `familias.can_invoice`. null = ainda não verificado. */
  canInvoice?: boolean | null;
  /** ADR-0151: codigo_pai do produto-base, quando este anúncio É um kit vinculado. null = não é kit. */
  kitBaseCodigoPai?: string | null;
  /** ADR-0154: true quando esta linha é um Kit Virtual (produtos distintos agrupados pelo ML),
   *  não um produto. `familiaId`/`codigoPai` são sentinelas sem significado — nunca usar como
   *  chave de agrupamento (repPorCodigo/ehKitVinculado); a tela renderiza este item numa linha
   *  própria, sem Pausar/Reativar/Remover (Publicados.tsx, ADR-0154 D-2/D-14). */
  ehKitVirtual?: boolean;
  /**
   * O anúncio EXISTE no ML mas a publicação não concluiu — `familias.ml_item_id` vazio com item vivo
   * lá fora (incidente 2026-09-10, adendo do ADR-0088). Sem esta linha o produto sumia da tela e
   * seguia vendendo sem baixar estoque. A tela pinta em vermelho e oferece só "Remover": republicar
   * daqui duplicaria o anúncio (a adoção da saga UP só vale por ~1h), e as demais ações pressupõem
   * publicação concluída.
   */
  publicacaoIncompleta?: boolean;
  /** ADR-0154: `kits_virtuais.id` — necessário para "Refazer kit" (encerrar-kit-virtual). Só
   *  presente quando `ehKitVirtual` é true. */
  kitVirtualId?: string;
  /** ADR-0161: migração para preço por variação em andamento no ML — trava
   *  Migrar/Pausar/Reativar/Remover desta linha. Durante a migração o ML recusa qualquer alteração
   *  no anúncio. `undefined` = false. */
  migracaoEmAndamento?: boolean;
  /** ADR-0161 (J10): o produto está publicado como VÁRIOS anúncios (split por faixa de preço,
   *  ADR-0048/0078) e por isso não pode migrar. A rotina de adoção zera o vínculo de todas as cores
   *  da família, inclusive das que vivem na partição que continua ativa — o UPDATE seguinte as
   *  trataria como novas e duplicaria variações num anúncio real. A edge function também recusa;
   *  aqui o botão simplesmente não aparece, para não oferecer o que vai ser negado. */
  produtoDividido?: boolean;
}

/**
 * Primeira palavra do fornecedor para exibição (ex.: "DETALLIA FITAS TEXTEIS LTDA" →
 * "DETALLIA"). Só visual — filtro/ordenação seguem pelo nome completo. Retorna null se vazio.
 */
export function primeiroNome(fornecedor: string | null | undefined): string | null {
  if (!fornecedor) return null;
  const trim = fornecedor.trim();
  if (!trim) return null;
  return trim.split(/\s+/)[0];
}

// Um anúncio no ML = um ml_item_id, mas após ciclos de UPDATE há VÁRIAS linhas em
// `familias` com o mesmo ml_item_id (uma por lote). A tela Publicados lista 1 por anúncio:
// agrupa por mlItemId e escolhe o representante (publicado real primeiro — publicadoEm não
// nulo; entre eles o mais antigo = publicação original). Preenche o fornecedor de qualquer
// linha do grupo que o tenha (lotes antigos podem não ter a coluna).
export function dedupePublicados(itens: PublicadoItem[]): PublicadoItem[] {
  const grupos = new Map<string, PublicadoItem[]>();
  for (const it of itens) {
    const arr = grupos.get(it.mlItemId);
    if (arr) arr.push(it);
    else grupos.set(it.mlItemId, [it]);
  }
  const out: PublicadoItem[] = [];
  for (const grupo of grupos.values()) {
    const rep = [...grupo].sort((a, b) => {
      if (a.publicadoEm && !b.publicadoEm) return -1;
      if (!a.publicadoEm && b.publicadoEm) return 1;
      if (a.publicadoEm && b.publicadoEm) return a.publicadoEm.localeCompare(b.publicadoEm);
      return 0;
    })[0];
    const fornecedor = rep.fornecedor ?? grupo.find((g) => g.fornecedor)?.fornecedor ?? null;
    // União dos identificadores de todos os ciclos: o representante é o mais antigo, mas a busca
    // precisa achar o anúncio por qualquer código/GTIN de variação (inclusive de ciclos de UPDATE).
    const identificadores = [...new Set(grupo.flatMap((g) => g.identificadores ?? []))];
    const catalogRetentavel = grupo.some((g) => g.catalogRetentavel);
    out.push({ ...rep, fornecedor, identificadores, catalogRetentavel });
  }
  return out;
}

// Rótulo grosso do tipo interno (fallback quando não há categoria real do ML).
const NOME_TIPO: Record<TipoAviamento, string> = {
  linha: 'Linha', fita: 'Fita', botao: 'Botão', cola: 'Cola', cursor: 'Cursor', outro: 'Outro',
};

/** Rótulo grosso do tipo de aviamento. null → "—". */
export function nomeTipo(tipo: TipoAviamento | null): string {
  return tipo ? NOME_TIPO[tipo] : '—';
}

/**
 * Rótulo de "Tipo" exibido na Publicados: a categoria-folha real do ML que a IA já resolveu
 * (ex.: "Alfinetes de Segurança"); na falta dela, o tipo interno grosso; senão "—".
 * Fonte única para coluna, filtro e ordenação (ficam sempre consistentes).
 */
export function rotuloTipo(item: Pick<PublicadoItem, 'categoria' | 'tipo'>): string {
  return item.categoria ?? nomeTipo(item.tipo);
}

/** Status que compõem o "comProblema" do Dashboard/cockpit — pendências acionáveis do anúncio. */
export const STATUS_PROBLEMA: ReadonlySet<StatusPublicado> = new Set<StatusPublicado>([
  'moderado',
  'inativo',
]);

export interface FiltroPublicados {
  fornecedor?: string | null;
  /** 'problema' é um filtro virtual: qualquer status em STATUS_PROBLEMA (não é um StatusPublicado real). */
  status?: StatusPublicado | 'problema' | null;
  /** Rótulo exibido de tipo (categoria real do ML, ou o rótulo grosso como "Outro"). */
  tipo?: string | null;
  busca?: string;
  /** Só "encalhados": anúncios ativos sem nenhuma venda no período (candidatos a revisão). */
  somenteEncalhados?: boolean;
  /** Só publicações incompletas (anúncio vivo no ML sem publicação concluída) — o chip vermelho. */
  somenteIncompletos?: boolean;
}

/** Anúncio encalhado: ativo e sem nenhuma venda no período. */
export function ehEncalhado(i: PublicadoItem): boolean {
  return i.status === 'ativo' && (i.unidadesVendidas ?? 0) === 0;
}

/** Cadastro fiscal incompleto no ML (ADR-0135 D-10) — false explícito, não null/undefined (ainda não verificado). */
export function fiscalPendente(i: Pick<PublicadoItem, 'canInvoice'>): boolean {
  return i.canInvoice === false;
}

export function filtrarPublicados(
  itens: PublicadoItem[],
  f: FiltroPublicados,
): PublicadoItem[] {
  const queryStr = (f.busca ?? '').trim().toLowerCase();
  const termosBusca = queryStr ? queryStr.split(/\s+/) : [];

  return itens.filter((i) => {
    if (f.fornecedor && i.fornecedor !== f.fornecedor) return false;
    if (f.status === 'problema') { if (!i.status || !STATUS_PROBLEMA.has(i.status)) return false; }
    else if (f.status && i.status !== f.status) return false;
    if (f.tipo && rotuloTipo(i) !== f.tipo) return false;
    if (f.somenteEncalhados && !ehEncalhado(i)) return false;
    if (f.somenteIncompletos && !i.publicacaoIncompleta) return false;

    if (termosBusca.length > 0) {
      const textoBuscavel = [
        i.titulo,
        i.codigoPai,
        i.fornecedor ?? '',
        rotuloTipo(i),
        i.gtin ?? '',
        ...(i.identificadores ?? []),
      ].join(' ').toLowerCase();

      // O texto buscável do item precisa conter TODOS os termos (ordem não importa)
      const matchBusca = termosBusca.every((termo) => textoBuscavel.includes(termo));
      if (!matchBusca) return false;
    }

    return true;
  });
}

// ── Ordenação por coluna ────────────────────────────────────────────────────

export type ColunaOrdenavel =
  | 'titulo'
  | 'fornecedor'
  | 'tipo'
  | 'precoPublicacao'
  | 'estoque'
  | 'precoAtual'
  | 'unidadesVendidas'
  | 'valorVendido'
  | 'status'
  | 'publicadoEm';

export interface OrdenacaoPublicados {
  coluna: ColunaOrdenavel;
  dir: 'asc' | 'desc';
}

// Severidade do status para a ordenação "Status" ser previsível (ativo→indisponível),
// em vez de alfabética do rótulo.
const STATUS_ORDEM: Record<StatusPublicado, number> = {
  ativo: 0, pausado: 1, encerrado: 2, moderado: 3, inativo: 4, indisponivel: 5,
};

function chaveOrdenacao(i: PublicadoItem, coluna: ColunaOrdenavel): string | number | null {
  switch (coluna) {
    case 'titulo': return i.titulo;
    case 'fornecedor': return i.fornecedor;
    case 'tipo': return rotuloTipo(i);
    case 'precoPublicacao': return i.precoPublicacao;
    case 'estoque': return i.estoque ?? null;
    case 'precoAtual': return i.precoAtual ?? null;
    case 'unidadesVendidas': return i.unidadesVendidas ?? null;
    case 'valorVendido': return i.valorVendido ?? null;
    case 'status': return STATUS_ORDEM[i.status ?? 'indisponivel'];
    case 'publicadoEm': return i.publicadoEm; // ISO 8601 ordena lexicograficamente
  }
}

// Ordena por coluna sem mutar a entrada. Valores nulos/vazios vão sempre para o fim,
// independente da direção. Strings comparam em pt-BR (acento/caixa-insensível, numérico).
export function ordenarPublicados(
  itens: PublicadoItem[],
  ord: OrdenacaoPublicados | null,
): PublicadoItem[] {
  if (!ord) return itens;
  const fator = ord.dir === 'asc' ? 1 : -1;
  return [...itens].sort((a, b) => {
    const va = chaveOrdenacao(a, ord.coluna);
    const vb = chaveOrdenacao(b, ord.coluna);
    const na = va == null || va === '';
    const nb = vb == null || vb === '';
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * fator;
    return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' }) * fator;
  });
}
