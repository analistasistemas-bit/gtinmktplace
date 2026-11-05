// Ancoragem (ADR-0048): monta o mapa sku → partição a partir das linhas de anuncios_externos do
// produto. Cada linha é um anúncio (partição) com seu mapa `variacoes_externas` (sku → dados ML).
// Uma cor já publicada fica ancorada na partição onde está — `particionar` usa isso para nunca
// migrar uma cor de anúncio entre updates.

export interface LinhaAnuncioParticao {
  particao: number;
  variacoes_externas: Record<string, unknown> | null;
}

export function montarAncoragem(linhas: LinhaAnuncioParticao[]): Map<string, number> {
  const m = new Map<string, number>();
  // ADR-0195: o espelho antigo do catálogo só poluiu a partição 0, então a maior vence SKU duplicado.
  for (const l of [...linhas].sort((a, b) => a.particao - b.particao)) {
    for (const sku of Object.keys(l.variacoes_externas ?? {})) {
      m.set(sku, l.particao);
    }
  }
  return m;
}
