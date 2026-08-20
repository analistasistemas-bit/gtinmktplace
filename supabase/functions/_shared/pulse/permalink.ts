// Resolve os links das ofertas sem assumir que o endpoint de catálogo os trouxe.
// A API de itens devolve um envelope por id, por isso uma resposta parcial não invalida o lote.
const API = 'https://api.mercadolibre.com';
const TAMANHO_LOTE = 20;

export interface OfertaComPermalink {
  item_id: string;
  permalink: string | null;
}

type BuscarJson = (input: RequestInfo | URL) => Promise<unknown>;

function permalinkValido(valor: unknown): valor is string {
  return typeof valor === 'string' && /^https?:\/\//.test(valor);
}

async function lerJson(resposta: unknown): Promise<unknown> {
  if (resposta && typeof (resposta as { json?: unknown }).json === 'function') {
    return (resposta as Response).json();
  }
  return resposta;
}

/**
 * Obtém somente os permalinks ausentes via multiget. Falhas de um lote preservam as ofertas e
 * reaproveitam o último link conhecido, para que a coleta principal continue normalmente.
 */
export async function enrichPulsePermalinks<T extends OfertaComPermalink>(
  ofertas: T[],
  buscar: BuscarJson,
  permalinksAnteriores: ReadonlyMap<string, string> = new Map(),
): Promise<T[]> {
  const ids = [...new Set(ofertas
    .filter((oferta) => !permalinkValido(oferta.permalink))
    .map((oferta) => oferta.item_id))];
  const permalinkPorId = new Map<string, string>();

  for (let inicio = 0; inicio < ids.length; inicio += TAMANHO_LOTE) {
    const lote = ids.slice(inicio, inicio + TAMANHO_LOTE);
    const params = new URLSearchParams({ ids: lote.join(','), attributes: 'id,permalink' });
    try {
      const json = await lerJson(await buscar(`${API}/items?${params}`));
      if (!Array.isArray(json)) continue;
      for (const resposta of json) {
        const envelope = resposta as { code?: unknown; body?: unknown };
        if (envelope.code !== 200) continue;
        const body = envelope.body as { id?: unknown; permalink?: unknown } | null;
        if (typeof body?.id === 'string' && permalinkValido(body.permalink)) {
          permalinkPorId.set(body.id, body.permalink);
        }
      }
    } catch (erro) {
      console.warn(`pulse-coletar: permalink de ${lote.length} oferta(s) falhou: ${(erro as Error).message}`);
    }
  }

  return ofertas.map((oferta) => {
    if (permalinkValido(oferta.permalink)) return oferta;
    const permalink = permalinkPorId.get(oferta.item_id) ?? permalinksAnteriores.get(oferta.item_id);
    return permalink ? { ...oferta, permalink } : oferta;
  });
}
