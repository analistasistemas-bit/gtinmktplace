// Preço BASE (de tabela) vivo de itens do ML, ignorando promoção. Usado por "Adicionar variação"
// (ADR-0129): a cor nova nasce com o preço base das irmãs no ML, não com o `preco_publicacao`
// local — que nunca acompanhou o ML e fez 5 cores nascerem a R$ 58,90 em 12/11/2026 (base 69,90,
// oferta 64,00). Em promoção o ML devolve `price` = oferta e `original_price` = tabela.
// ponytail: só `original_price` vivo; se o ML não o devolver numa oferta de seller-promotions, cai
// no `price` (preço da oferta) — upgrade: cruzar com ml_promocao_itens.preco_original.
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 10_000;
const MAX_IDS = 20; // limite do /items/bulk por requisição

type Corpo = { id?: unknown; price?: unknown; original_price?: unknown; status?: unknown };

const positivo = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
};

export function precoBaseDoItem(b: Pick<Corpo, 'price' | 'original_price'>): number | null {
  return positivo(b.original_price) ?? positivo(b.price);
}

/** Menor preço base entre os itens vivos lidos. `null` = não deu para ler (fail-closed): quem chama
 *  recusa em vez de cair em um preço local defasado. */
export async function lerPrecoBaseVivo(
  token: string, ids: string[], f: typeof fetch = fetch,
): Promise<number | null> {
  const unicos = [...new Set(ids)].slice(0, MAX_IDS);
  if (unicos.length === 0) return null;
  try {
    const r = await f(`${API}${caminhoMultiget(unicos, 'id,price,original_price,status')}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const linhas = comoEnvelopeAntigo(await r.json(), unicos);
    const bases = (Array.isArray(linhas) ? linhas : [])
      .filter((l: { code?: number; body?: Corpo }) => l?.code === 200 && l.body && l.body.status !== 'closed')
      .map((l: { body: Corpo }) => precoBaseDoItem(l.body))
      .filter((p): p is number => p !== null);
    return bases.length > 0 ? Math.min(...bases) : null;
  } catch (e) {
    console.error('preco-base-vivo: leitura falhou:', e);
    return null;
  }
}
