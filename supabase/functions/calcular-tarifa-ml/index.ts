import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { montarTarifa } from '../_shared/ml/tarifa.ts';
import { buscarListingPrice } from '../_shared/ml/listing-prices.ts';
import { buscarFreteVendedor } from '../_shared/ml/frete.ts';
import type { DimensoesPacote } from '../_shared/ml/pacote.ts';

const CACHE_TTL_S = 6 * 60 * 60; // 6h — comissões mudam raramente

function lerDimensoes(raw: unknown): DimensoesPacote {
  const d = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    altura_cm: num(d.altura_cm),
    largura_cm: num(d.largura_cm),
    comprimento_cm: num(d.comprimento_cm),
    peso_gramas: num(d.peso_gramas),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  // Gate de auth: só membro autenticado; a conta ML usada é a da própria org.
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { preco, categoria_ml_id, dimensoes } = await req.json().catch(() => ({}));
  if (typeof preco !== 'number' || preco <= 0 || typeof categoria_ml_id !== 'string' || !categoria_ml_id) {
    return new Response('preco (>0) e categoria_ml_id obrigatórios', { status: 400, headers: corsHeaders });
  }
  const dim = lerDimensoes(dimensoes);

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const admin = adminClient();
  // Conexão ML da org (E7), não a do chamador: tarifa/frete usam a conta da organização.
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) return json({ erro: true });

  const precoKey = preco.toFixed(2);
  // Frete depende do peso/dimensões e da reputação do vendedor → entram na chave.
  const dimKey = `${dim.altura_cm ?? 0}x${dim.largura_cm ?? 0}x${dim.comprimento_cm ?? 0}x${dim.peso_gramas ?? 0}`;
  const cacheKey = `tarifa:v2:${orgId}:${categoria_ml_id}:${precoKey}:${dimKey}`;

  try {
    const cached = await redisGet(cacheKey);
    if (cached) return json(JSON.parse(cached));

    const token = await getValidAccessTokenConexao(conexao);

    const [classicoML, premiumML, frete] = await Promise.all([
      buscarListingPrice(token, preco, categoria_ml_id, 'gold_special'),
      buscarListingPrice(token, preco, categoria_ml_id, 'gold_pro'),
      conexao.contaExternaId
        ? buscarFreteVendedor(token, conexao.contaExternaId, preco, categoria_ml_id, dim)
        : Promise.resolve(0),
    ]);
    const tarifa = montarTarifa(preco, classicoML, premiumML, frete);

    await redisSet(cacheKey, JSON.stringify(tarifa), CACHE_TTL_S);
    return json(tarifa);
  } catch (err) {
    // Resiliente: não quebra a Revisão; o card mostra "indisponível".
    console.error('calcular-tarifa-ml falhou:', err);
    return json({ erro: true });
  }
});
