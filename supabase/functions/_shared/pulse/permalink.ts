export interface OfertaComPermalink {
  item_id: string;
  permalink: string | null;
}

function permalinkValido(valor: unknown): valor is string {
  return typeof valor === 'string' && /^https?:\/\//.test(valor);
}

function permalinkDoItem(itemId: string): string | null {
  const match = /^MLB-?(\d+)$/.exec(itemId);
  return match ? `https://produto.mercadolivre.com.br/MLB-${match[1]}` : null;
}

/**
 * Garante um link público para cada oferta brasileira sem consultar os detalhes do concorrente,
 * endpoint que o Mercado Livre restringe ao titular do anúncio.
 */
export function enrichPulsePermalinks<T extends OfertaComPermalink>(
  ofertas: T[],
  permalinksAnteriores: ReadonlyMap<string, string> = new Map(),
): T[] {
  return ofertas.map((oferta) => {
    if (permalinkValido(oferta.permalink)) return oferta;
    const anterior = permalinksAnteriores.get(oferta.item_id);
    const permalink = permalinkValido(anterior) ? anterior : permalinkDoItem(oferta.item_id);
    return permalink ? { ...oferta, permalink } : oferta;
  });
}
