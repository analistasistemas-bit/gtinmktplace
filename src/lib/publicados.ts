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
    out.push({ ...rep, fornecedor, identificadores });
  }
  return out;
}

// Rótulo grosso do tipo interno (fallback quando não há categoria real do ML).
const NOME_TIPO: Record<TipoAviamento, string> = {
  linha: 'Linha', fita: 'Fita', botao: 'Botão', cola: 'Cola', outro: 'Outro',
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

export interface FiltroPublicados {
  fornecedor?: string | null;
  status?: StatusPublicado | null;
  /** Rótulo exibido de tipo (categoria real do ML, ou o rótulo grosso como "Outro"). */
  tipo?: string | null;
  busca?: string;
  /** Só "encalhados": anúncios ativos sem nenhuma venda no período (candidatos a revisão). */
  somenteEncalhados?: boolean;
}

/** Anúncio encalhado: ativo e sem nenhuma venda no período. */
export function ehEncalhado(i: PublicadoItem): boolean {
  return i.status === 'ativo' && (i.unidadesVendidas ?? 0) === 0;
}

export function filtrarPublicados(
  itens: PublicadoItem[],
  f: FiltroPublicados,
): PublicadoItem[] {
  const q = (f.busca ?? '').trim().toLowerCase();
  return itens.filter(
    (i) =>
      (!f.fornecedor || i.fornecedor === f.fornecedor) &&
      (!f.status || i.status === f.status) &&
      (!f.tipo || rotuloTipo(i) === f.tipo) &&
      (!q ||
        i.titulo.toLowerCase().includes(q) ||
        i.codigoPai.toLowerCase().includes(q) ||
        (i.fornecedor ?? '').toLowerCase().includes(q) ||
        rotuloTipo(i).toLowerCase().includes(q) ||
        (i.gtin ?? '').toLowerCase().includes(q) ||
        (i.identificadores ?? []).some((c) => c.toLowerCase().includes(q))) &&
      (!f.somenteEncalhados || ehEncalhado(i)),
  );
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
