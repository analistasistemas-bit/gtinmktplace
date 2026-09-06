export interface MapaCanonico {
  listings: Record<string, string>;
  gtins?: Record<string, string>;
  conhecidos?: Set<string>;
}

export type LinhaFamilia = { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
export type LinhaVariacao = { catalog_listing_id: string | null; familias: LinhaFamilia };
export type LinhaItemUP = { catalog_listing_id: string | null; item_externo_id: string | null };
export type LinhaGtin = { gtin: string | null; familias: LinhaFamilia };

const normGtin = (g: string) => g.replace(/^0+/, '');
const chaveGtin = (g: string | null | undefined) => {
  const s = (g ?? '').trim();
  return s === '' ? null : normGtin(s);
};

export function canonizarItem(mlItemId: string, mapa?: MapaCanonico, ean?: string | null): string {
  if (!mapa) return mlItemId;
  const dono = mapa.listings[mlItemId];
  if (dono) return dono;
  if (mapa.conhecidos?.has(mlItemId)) return mlItemId;
  const gtin = chaveGtin(ean);
  return (gtin ? mapa.gtins?.[gtin] : undefined) ?? mlItemId;
}

const donoDe = (f: LinhaFamilia) => (Array.isArray(f) ? f[0] : f)?.ml_item_id ?? null;

export function montarMapaCanonico(
  variacoes: LinhaVariacao[], itensUP: LinhaItemUP[], gtins: LinhaGtin[] = [],
  anunciosConhecidos: (string | null)[] = [],
): MapaCanonico {
  const listings: Record<string, string> = {};
  const por = (listing: string | null, dono: string | null | undefined) => {
    if (!listing || !dono || listing === dono) return;
    listings[listing] = dono;
  };
  for (const v of variacoes) por(v.catalog_listing_id, donoDe(v.familias));
  for (const i of itensUP) por(i.catalog_listing_id, i.item_externo_id);

  const donosPorGtin = new Map<string, Set<string>>();
  for (const g of gtins) {
    const dono = donoDe(g.familias);
    const chave = chaveGtin(g.gtin);
    if (!chave || !dono) continue;
    const s = donosPorGtin.get(chave) ?? new Set<string>();
    s.add(dono);
    donosPorGtin.set(chave, s);
  }
  const mapaGtins: Record<string, string> = {};
  for (const [gtin, donos] of donosPorGtin) {
    if (donos.size === 1) mapaGtins[gtin] = [...donos][0];
  }
  return { listings, gtins: mapaGtins, conhecidos: new Set(anunciosConhecidos.filter((x): x is string => !!x)) };
}
