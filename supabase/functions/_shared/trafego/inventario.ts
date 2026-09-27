// Inventário de MLBs a coletar: união das 7 fontes de `varrer-anuncios-orfaos/index.ts` (que já
// devolvem `string | null`, sem normalização — ver `add()` ali) mais os vendidos em 180 dias,
// deduplicada, restrita a `MLB\d+` e sem os encerrados há mais de 30 dias (`ml_trafego_item`).
export interface FontesInventario {
  familias: string[];
  anunciosExternos: string[];
  itensUp: string[];
  kitsVirtuais: string[];
  catalogoVariacoes: string[];
  catalogoItensUp: string[];
  pxvAnteriores: string[];
  vendidos: string[];
}

const MLB_RE = /^MLB\d+$/;

/** Puro: as 8 fontes já vêm carregadas (IO fica no worker). Ordenada por code units. */
export function montarInventario(
  fontes: FontesInventario,
  encerradosHaMaisDe30d: Set<string>,
): string[] {
  const out = new Set<string>();
  for (const lista of Object.values(fontes)) {
    if (!Array.isArray(lista)) continue;
    for (const id of lista) {
      if (typeof id === 'string' && MLB_RE.test(id) && !encerradosHaMaisDe30d.has(id)) out.add(id);
    }
  }
  return Array.from(out).sort();
}
