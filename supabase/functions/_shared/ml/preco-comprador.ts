// Preço que o comprador paga agora, por MLB (ADR-0210, emenda 5). SÓ GET. `price` do /items não acompanha promoção
// (medido em 2026-11-25): quem calcula margem usa este. Quem chama garante que o MLB é da conta da conexão.
import { parseSalePrice } from '../trafego/parsers.ts';
import { emParalelo } from '../promocoes/sincronizar.ts';

export interface PrecoComprador {
  preco: number; precoTabela: number | null;
  /** null = metadado e valores não concordam. */
  emPromocao: boolean | null;
  /** `metadata.promotion_type` do ML (ex.: lightning). */
  promocaoTipo: string | null;
  priceId: string | null;
  lidoEm: string;
}
interface Opcoes { f?: typeof fetch; prazoMs?: number }

const API = 'https://api.mercadolibre.com';
const CONCORRENCIA = 8;
const PRAZO_TOTAL_MS = 20_000;
const TIMEOUT_MS = 5_000;
type Obj = Record<string, unknown>;
const obj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const texto = (x: unknown) => (typeof x === 'string' && x ? x : null);
const centavos = (n: number) => Math.round(n * 100);

export function parsePrecoComprador(json: unknown, lidoEm: string): PrecoComprador | null {
  const p = parseSalePrice(json);
  if (!p || p.preco <= 0 || p.moeda !== 'BRL') return null;
  const j = json as Obj;
  const promocaoTipo = obj(j.metadata) ? texto(j.metadata.promotion_type) : null;
  const acima = p.precoRegular != null && centavos(p.precoRegular) > centavos(p.preco);
  return {
    preco: p.preco, precoTabela: acima ? p.precoRegular : null,
    emPromocao: acima ? true : promocaoTipo ? null : false,
    promocaoTipo, priceId: texto(j.price_id), lidoEm,
  };
}

/** GET por id, 8 em paralelo, com timeout por chamada e prazo total. 429 ou prazo vencido: nada novo começa. */
async function lerCada<T>(
  token: string, alvos: { mlb: string; caminho: string }[], ler: (json: unknown, i: number) => T | null, o: Opcoes,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const f = o.f ?? fetch;
  const fim = Date.now() + (o.prazoMs ?? PRAZO_TOTAL_MS);
  let parou = false;
  let falhas = 0;
  await emParalelo(alvos.map((a, i) => ({ ...a, i })), CONCORRENCIA, async ({ mlb, caminho, i }) => {
    const resta = fim - Date.now();
    if (parou || resta <= 0) { falhas++; return; }
    try {
      const r = await f(`${API}${caminho}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, resta)),
      });
      if (r.status === 429) parou = true;
      const v = r.status === 200 ? ler(await r.json(), i) : null;
      if (v != null) out.set(mlb, v);
      else falhas++;
    } catch {
      falhas++; // sem a mensagem: pode carregar dado de outra camada
    }
  });
  if (falhas) console.warn('[preco-comprador] leituras sem resposta', { quantidade: falhas, limite_ml: parou });
  return out;
}

/** Preço por MLB; ausente do mapa = não verificado (nunca vira preço de tabela nem `price`). */
export function lerPrecosComprador(token: string, ids: string[], o: Opcoes = {}): Promise<Map<string, PrecoComprador>> {
  const alvos = [...new Set(ids)].map((mlb) => ({
    mlb, caminho: `/items/${encodeURIComponent(mlb)}/sale_price?context=channel_marketplace`,
  }));
  return lerCada(token, alvos, (j) => parsePrecoComprador(j, new Date().toISOString()), o);
}

/** Fim da promoção pela linha do `/prices` com o mesmo `price_id` e o mesmo preço; qualquer dúvida = ausente. */
export function lerFimPromocao(
  token: string, alvos: { mlb: string; priceId: string; preco: number }[], o: Opcoes & { agora: Date },
): Promise<Map<string, string>> {
  return lerCada(token, alvos.map(({ mlb }) => ({ mlb, caminho: `/items/${encodeURIComponent(mlb)}/prices` })), (j, i) => {
    const { priceId, preco } = alvos[i];
    const linhas = obj(j) && Array.isArray(j.prices) ? j.prices.filter((x): x is Obj => obj(x) && x.id === priceId) : [];
    if (linhas.length !== 1) return null;
    const { amount, conditions } = linhas[0];
    if (typeof amount !== 'number' || centavos(amount) !== centavos(preco) || !obj(conditions)) return null;
    const t = typeof conditions.end_time === 'string' ? Date.parse(conditions.end_time) : NaN;
    return t > o.agora.getTime() ? new Date(t).toISOString() : null;
  }, o);
}
