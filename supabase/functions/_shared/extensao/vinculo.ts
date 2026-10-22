// Vínculo anúncio do ML → variação da organização (ADR-0189 D-8). Lógica pura com deps
// injetadas; a edge implementa as consultas. Sem imports de runtime além de folhas relativas.
import type { DimensoesPacote } from '../ml/pacote.ts';
import { gtinOuNull } from '../produto/gtin.ts';

export type FonteCusto = 'catalogo' | 'ean_da_busca' | 'vinculo_manual' | 'nenhuma';

export interface VariacaoCusto {
  variacaoId: string;
  codigo: string;
  custo: number | null;
  /** null = família sem origem cadastrada: a margem fica indisponível, nunca presumida. */
  origem: 'nacional' | 'importado' | null;
  /** UNITS_PER_PACK declarado no anúncio do próprio SKU (familias.atributos_ml); null = composição não confirmada. */
  unidades: number | null;
  /** familias.codigo_pai: acha o kit vinculado desta família (dimensões próprias do pacote). */
  codigoPai: string | null;
  dimensoes: DimensoesPacote | null;
}

export interface DepsVinculo {
  porCatalogo(orgId: string, catalogProductId: string): Promise<VariacaoCusto[]>;
  porGtin(orgId: string, gtin: string): Promise<VariacaoCusto[]>;
  porVinculoManual(orgId: string, chave: { tipo: 'catalogo' | 'item'; valor: string }): Promise<VariacaoCusto | null>;
}

/** Catálogo → EAN da busca → vínculo manual (catálogo, depois item) → nenhuma.
 *  Etapa com mais de uma variação é ambígua e não escolhe: passa para a próxima. */
export async function resolverVinculo(
  orgId: string,
  e: { catalogProductId: string | null; mlItemId: string; eanDaBusca: string | null },
  deps: DepsVinculo,
): Promise<{ fonte: FonteCusto; variacao: VariacaoCusto | null }> {
  if (e.catalogProductId != null) {
    const r = await deps.porCatalogo(orgId, e.catalogProductId);
    if (r.length === 1) return { fonte: 'catalogo', variacao: r[0] };
  }
  const gtin = gtinOuNull(e.eanDaBusca);
  if (gtin != null) {
    const r = await deps.porGtin(orgId, gtin);
    if (r.length === 1) return { fonte: 'ean_da_busca', variacao: r[0] };
  }
  if (e.catalogProductId != null) {
    const m = await deps.porVinculoManual(orgId, { tipo: 'catalogo', valor: e.catalogProductId });
    if (m) return { fonte: 'vinculo_manual', variacao: m };
  }
  const m = await deps.porVinculoManual(orgId, { tipo: 'item', valor: e.mlItemId });
  if (m) return { fonte: 'vinculo_manual', variacao: m };
  return { fonte: 'nenhuma', variacao: null };
}
