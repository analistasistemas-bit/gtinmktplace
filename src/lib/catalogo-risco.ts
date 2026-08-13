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
  variacoes: Array<{ catalog_status: string | null; ml_variation_id: string | null }>;
}

export interface AnuncioEmRisco {
  mlItemId: string;
  titulo: string;
  qtdSemFicha: number;
  motivoPredominante: StatusRisco;
  url: string;
}

const ehRisco = (s: string | null): s is StatusRisco => (STATUS_RISCO as readonly string[]).includes(s ?? '');

export function agruparCatalogoRisco(rows: FamiliaRiscoRow[]): AnuncioEmRisco[] {
  // Agrega por ml_item_id: várias famílias compartilham o mesmo anúncio após ciclos de UPDATE
  // (mesmo dedupe de fetchPublicados).
  const porItem = new Map<string, { titulo: string; contagem: Map<StatusRisco, number> }>();
  for (const f of rows) {
    if (!f.ml_item_id) continue;
    const emRisco = f.variacoes.filter((v) => v.ml_variation_id != null && ehRisco(v.catalog_status));
    if (emRisco.length === 0) continue;
    const atual = porItem.get(f.ml_item_id) ?? {
      titulo: f.titulo_ml ?? f.nome_pai ?? f.ml_item_id,
      contagem: new Map<StatusRisco, number>(),
    };
    if (atual.titulo === f.ml_item_id && (f.titulo_ml ?? f.nome_pai)) atual.titulo = f.titulo_ml ?? f.nome_pai!;
    for (const v of emRisco) {
      const s = v.catalog_status as StatusRisco;
      atual.contagem.set(s, (atual.contagem.get(s) ?? 0) + 1);
    }
    porItem.set(f.ml_item_id, atual);
  }
  return [...porItem.entries()].map(([mlItemId, { titulo, contagem }]) => {
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
    };
  });
}
