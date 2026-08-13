// Tela "Catálogo em risco" (spec 2026-08-12). Só variações PUBLICADAS contam
// (ml_variation_id não nulo) — sem esse filtro, 2.234 falsos positivos (linhas
// nunca publicadas carregam o default 'pendente' da coluna).
export const STATUS_RISCO = ['ficha_divergente', 'sem_produto', 'nao_elegivel', 'pendente'] as const;
export type StatusRisco = (typeof STATUS_RISCO)[number];

export const ROTULO_RISCO: Record<StatusRisco, string> = {
  ficha_divergente: 'Ficha divergente',
  sem_produto: 'Sem ficha no catálogo',
  nao_elegivel: 'Não elegível',
  pendente: 'Elegibilidade não resolvida',
};

export interface FamiliaRiscoRow {
  id: string;
  ml_item_id: string | null;
  titulo_ml: string | null;
  nome_pai: string | null;
  variacoes: Array<{
    catalog_status: string | null;
    ml_variation_id: string | null;
    catalog_product_id: string | null;
  }>;
}

export interface AnuncioEmRisco {
  mlItemId: string;
  titulo: string;
  qtdSemFicha: number;
  motivoPredominante: StatusRisco;
  url: string;
  /** ml_variation_id publicados em status de risco — a extensão manda null para eles. */
  variacoesRisco: string[];
  /** ml_variation_id -> catalog_product_id das variações 'vinculado' — a extensão preserva exatamente estes. */
  vinculos: Record<string, string>;
  /** ml_variation_id === ml_item_id (ADR-0084): fluxo individual no ML, fora do lote da extensão. */
  itemPlano: boolean;
}

const ehRisco = (s: string | null): s is StatusRisco => (STATUS_RISCO as readonly string[]).includes(s ?? '');

export function agruparCatalogoRisco(rows: FamiliaRiscoRow[]): AnuncioEmRisco[] {
  // Agrega por ml_item_id: várias famílias compartilham o mesmo anúncio após ciclos de UPDATE
  // (mesmo dedupe de fetchPublicados).
  const porItem = new Map<string, {
    titulo: string;
    contagem: Map<StatusRisco, number>;
    variacoesRisco: string[];
    itemPlano: boolean;
  }>();
  for (const f of rows) {
    if (!f.ml_item_id) continue;
    const emRisco = f.variacoes.filter((v) => v.ml_variation_id != null && ehRisco(v.catalog_status));
    if (emRisco.length === 0) continue;
    const atual = porItem.get(f.ml_item_id) ?? {
      titulo: f.titulo_ml ?? f.nome_pai ?? f.ml_item_id,
      contagem: new Map<StatusRisco, number>(),
      variacoesRisco: [],
      itemPlano: false,
    };
    if (atual.titulo === f.ml_item_id && (f.titulo_ml ?? f.nome_pai)) atual.titulo = f.titulo_ml ?? f.nome_pai!;
    for (const v of emRisco) {
      const s = v.catalog_status as StatusRisco;
      atual.contagem.set(s, (atual.contagem.get(s) ?? 0) + 1);
      atual.variacoesRisco.push(v.ml_variation_id!);
      if (v.ml_variation_id === f.ml_item_id) atual.itemPlano = true;
    }
    porItem.set(f.ml_item_id, atual);
  }

  // Segunda passada: agrega vínculos confirmados de TODAS as rows (inclusive famílias
  // só-vinculado, que não geram entrada em porItem por não terem variação de risco).
  const vinculosPorItem = new Map<string, Record<string, string>>();
  for (const f of rows) {
    if (!f.ml_item_id || !porItem.has(f.ml_item_id)) continue;
    const alvo = vinculosPorItem.get(f.ml_item_id) ?? {};
    for (const v of f.variacoes) {
      if (v.catalog_status === 'vinculado' && v.ml_variation_id != null && v.catalog_product_id != null) {
        alvo[v.ml_variation_id] = v.catalog_product_id;
      }
    }
    vinculosPorItem.set(f.ml_item_id, alvo);
  }

  return [...porItem.entries()].map(([mlItemId, { titulo, contagem, variacoesRisco, itemPlano }]) => {
    let motivoPredominante: StatusRisco = STATUS_RISCO[0];
    let max = -1;
    for (const s of STATUS_RISCO) {
      const n = contagem.get(s) ?? 0;
      if (n > max) { max = n; motivoPredominante = s; }
    }
    const qtdSemFicha = [...contagem.values()].reduce((a, b) => a + b, 0);
    return {
      mlItemId, titulo, qtdSemFicha, motivoPredominante,
      url: `https://www.mercadolivre.com.br/produzir/catalogo/${mlItemId}`,
      variacoesRisco,
      vinculos: vinculosPorItem.get(mlItemId) ?? {},
      itemPlano,
    };
  });
}

/**
 * Decisão do Diego (2026-08-13): o card passa a listar SÓ os anúncios que o ML sinaliza com a
 * tag `catalog_forewarning` (StatusCanal.catalogForewarning, lido ao vivo por useStatusPublicados)
 * — a fonte real de "próximo a ser pausado". A inferência local por `catalog_status` acima
 * continua sendo a base de dados (variações/vínculos para a extensão), mas os demais anúncios
 * inferidos somem da tela, sem virar seção secundária.
 */
export function filtrarCatalogForewarning(
  itens: AnuncioEmRisco[],
  comForewarning: ReadonlySet<string>,
): AnuncioEmRisco[] {
  return itens.filter((i) => comForewarning.has(i.mlItemId));
}
