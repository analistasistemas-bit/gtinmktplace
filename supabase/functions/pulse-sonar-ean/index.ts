// Sonar — busca por EAN/GTIN (ADR-0127 Errata 1): par das pulse-sonar-vendas/visitas, edge
// separada de propósito — o lookup oficial do catálogo é grátis e único produto (não nicho); o
// bloco pago (Apify) é opt-in do operador e sua falha degrada só esse pedaço, nunca o resto.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { apifyConfigurado, buscarAnunciosML } from '../_shared/apify/client.ts';
import { parseItensApify, type ItemVendas } from '../_shared/pulse/sonar-vendas.ts';
import {
  aplicarPrecoVencedorCatalogo, parseDescricaoCatalogo, parseItensProduto, parseNomeProdutoBusca,
  parseProdutoBusca,
} from '../_shared/concorrencia/parse.ts';
import type { OfertaVendedor } from '../_shared/concorrencia/tipos.ts';
import { montarRespostaEan, validarEan } from '../_shared/pulse/sonar-ean.ts';

const API = 'https://api.mercadolibre.com';
// Preço/oferta muda mais rápido que "vendidos" — TTL menor que o de sonar-vendas (7d).
const CACHE_TTL_LOOKUP_S = 24 * 60 * 60;
// Mesmo racional da pulse-sonar-vendas: "vendidos" quase não muda dia a dia, e cada run custa
// dinheiro — reusar por até 7 dias evita repagar a mesma busca.
const CACHE_TTL_VENDAS_S = 7 * 24 * 60 * 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

interface LookupCache {
  product_id: string | null; // null = tombstone: EAN sem ficha de catálogo, não rebusca
  nome_produto: string | null;
  descricao_catalogo: string | null;
  ofertas: OfertaVendedor[];
}

/** `null` = falha transitória do ML (timeout/5xx) — NUNCA cacheia, distingue de "EAN sem
 *  ficha" (HTTP 200 com `results` vazio, isso sim é tombstone válido). Mesma regra da
 *  pulse-sonar-visitas: erro transitório não pode travar a resposta por 24h com afirmação falsa. */
async function resolverLookup(ean: string, token: string): Promise<LookupCache | null> {
  const chave = `sonar:ean:v1:${ean}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return JSON.parse(cacheado);

  const busca = await mlGet(
    `${API}/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(ean)}`,
    token,
  );
  if (busca === null) return null; // falha do ML, não "sem ficha"
  const productId = parseProdutoBusca(busca);
  if (!productId) {
    const tombstone: LookupCache = { product_id: null, nome_produto: null, descricao_catalogo: null, ofertas: [] };
    await redisSet(chave, JSON.stringify(tombstone), CACHE_TTL_LOOKUP_S).catch(() => {});
    return tombstone;
  }

  const [produtoJson, itensJson] = await Promise.all([
    mlGet(`${API}/products/${productId}`, token),
    mlGet(`${API}/products/${productId}/items`, token),
  ]);
  // `itensJson` é a lista de ofertas — se o ML falhou em devolvê-la, `parseItensProduto` cairia
  // no shape vazio e cachearia "sem ofertas ativas" como se fosse dado confirmado. `produtoJson`
  // nulo é tolerável (só perde o preço vencedor/descrição do catálogo, `aplicarPrecoVencedorCatalogo`
  // já degrada sozinho para esse caso).
  if (itensJson === null) return null;
  const itensComPrecos = aplicarPrecoVencedorCatalogo(itensJson, produtoJson);
  const dadosOfertas = parseItensProduto(itensComPrecos);
  const lookup: LookupCache = {
    product_id: productId,
    nome_produto: parseNomeProdutoBusca(busca),
    descricao_catalogo: parseDescricaoCatalogo(produtoJson),
    ofertas: dadosOfertas.ofertas_detalhe,
  };
  await redisSet(chave, JSON.stringify(lookup), CACHE_TTL_LOOKUP_S).catch(() => {});
  return lookup;
}

/** null = run não pôde ser feito/falhou (chamador marca vendas_indisponivel); nunca lança. */
async function resolverVendasApify(ean: string): Promise<ItemVendas[] | null> {
  const chave = `sonar:ean-vendas:v1:${ean}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return JSON.parse(cacheado);

  const brutos = await buscarAnunciosML(ean);
  if (brutos === null) return null;
  const itens = parseItensApify(brutos);
  await redisSet(chave, JSON.stringify(itens), CACHE_TTL_VENDAS_S).catch(() => {});
  return itens;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'read' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'pulse'))) {
    return json({ erro: 'Módulo Pulse não habilitado para esta organização.' }, 403);
  }

  let body: { ean?: unknown; com_vendas?: unknown };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const ean = validarEan(body.ean);
  if (!ean) return json({ erro: 'EAN inválido — informe 8 a 14 dígitos.' }, 400);
  const comVendasPedido = body.com_vendas === true;

  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  // Sem conexão ML → indisponível explícito com 200 (mesmo padrão das outras rotas do Sonar).
  if (!conexao) return json({ conectado: false });
  const token = await getValidAccessTokenConexao(conexao);

  const lookup = await resolverLookup(ean, token);
  // Falha transitória do ML (timeout/5xx) — nunca vira "EAN sem ficha", mesmo padrão de erro
  // explícito da pulse-sonar-vendas (502, "tente de novo").
  if (lookup === null) {
    return json({ erro: 'Consulta ao Mercado Livre falhou ou demorou demais. Tente de novo em instantes.' }, 502);
  }
  // EAN sem ficha de catálogo (ex.: faixa GS1 interna de aviamento) — resposta válida, não erro.
  if (lookup.product_id === null) return json({ conectado: true, catalogado: false });

  let itensApify: ItemVendas[] | null = null;
  let vendasIndisponivel = false;
  if (comVendasPedido) {
    if (!apifyConfigurado()) {
      vendasIndisponivel = true;
    } else {
      itensApify = await resolverVendasApify(ean);
      vendasIndisponivel = itensApify === null;
    }
  }

  return json(montarRespostaEan({
    ean,
    productId: lookup.product_id,
    nomeProduto: lookup.nome_produto,
    descricaoCatalogo: lookup.descricao_catalogo,
    comVendas: itensApify !== null,
    vendasIndisponivel,
    ofertasOficiais: lookup.ofertas,
    itensApify,
    geradoEm: new Date().toISOString(),
  }));
});
