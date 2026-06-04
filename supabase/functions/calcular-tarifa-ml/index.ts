import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { montarTarifa, type ListingPriceML } from '../_shared/ml/tarifa.ts';

const CACHE_TTL_S = 6 * 60 * 60; // 6h — comissões mudam raramente

async function listingPrice(
  token: string,
  preco: number,
  categoria: string,
  listingType: string,
): Promise<ListingPriceML> {
  const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?price=${preco}&category_id=${categoria}&listing_type_id=${listingType}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`listing_prices ${listingType} ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<ListingPriceML>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { preco, categoria_ml_id } = await req.json().catch(() => ({}));
  if (typeof preco !== 'number' || preco <= 0 || typeof categoria_ml_id !== 'string' || !categoria_ml_id) {
    return new Response('preco (>0) e categoria_ml_id obrigatórios', { status: 400, headers: corsHeaders });
  }

  const precoKey = preco.toFixed(2);
  const cacheKey = `tarifa:${categoria_ml_id}:${precoKey}`;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const cached = await redisGet(cacheKey);
    if (cached) return json(JSON.parse(cached));

    const token = await getValidAccessToken(user.id);
    const [classicoML, premiumML] = await Promise.all([
      listingPrice(token, preco, categoria_ml_id, 'gold_special'),
      listingPrice(token, preco, categoria_ml_id, 'gold_pro'),
    ]);
    const tarifa = montarTarifa(preco, classicoML, premiumML);

    await redisSet(cacheKey, JSON.stringify(tarifa), CACHE_TTL_S);
    return json(tarifa);
  } catch (err) {
    // Resiliente: não quebra a Revisão; o card mostra "indisponível".
    console.error('calcular-tarifa-ml falhou:', err);
    return json({ erro: true });
  }
});
