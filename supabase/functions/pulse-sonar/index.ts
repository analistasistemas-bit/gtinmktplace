// Sonar (ADR-0120): garimpo on-demand por termo. Só leitura; cache global 24h.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { parseOfertasProduto, ofertasNaoLidas } from '../_shared/pulse/parse.ts';
import type { OfertaColetada } from '../_shared/pulse/tipos.ts';
import { ufDoVendedor } from '../_shared/pulse/vendedor.ts';
import { buscarCategoriaPreditor } from '../_shared/ml/domain-discovery.ts';
import { montarPainelSonar, parseFichasBusca, parseVisitasJanela, resumoPrecos, type FichaBusca, type ResultadoFicha } from '../_shared/pulse/sonar.ts';

const API = 'https://api.mercadolibre.com';
const FICHAS_POR_BUSCA = 20; // ponytail: teto fixo; paginação "carregar mais" quando provar demanda
const LOTE_CONCORRENCIA = 5; // teto de fichas em paralelo, para não estourar rate limit do ML
const CACHE_TTL_S = 24 * 60 * 60; // dado público; chave global sem org_id (ADR-0120 §3)
const normalizarTermo = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Contém falha E travamento no call site: buscarCategoriaPreditor é compartilhado com o fluxo de
// publish (_shared/ml/domain-discovery.ts) e não pode ganhar timeout lá. Sem isso, um fetch
// interno que rejeita ou nunca resolve derruba a ficha INTEIRA em processarFicha (perde
// ofertas/preço/vendedores por causa só da categoria).
const comTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    p.catch(() => fallback),
    new Promise<T>((res) => setTimeout(() => res(fallback), ms)),
  ]);

// Visitas: só o item MAIS BARATO da ficha (proxy do ganhador). Multiget não serve — "maximum
// amount of items to query is 1" (testado 17/08).
async function resolverVisitas(ofertas: OfertaColetada[], token: string) {
  if (ofertas.length === 0) return null;
  const maisBarato = ofertas.reduce((min, o) => (o.preco < min.preco ? o : min));
  const resp = await mlGet(`${API}/items/${maisBarato.item_id}/visits/time_window?last=30&unit=day`, token);
  return parseVisitasJanela(resp);
}

interface InfoVendedor { uf: string | null; transacoes_total: number | null }

// Cache por seller DENTRO da request: sellers repetem entre fichas.
async function resolverVendedor(sellerId: number, token: string, cache: Map<number, InfoVendedor>): Promise<InfoVendedor> {
  const cacheado = cache.get(sellerId);
  if (cacheado) return cacheado;
  const resp = await mlGet(`${API}/users/${sellerId}`, token);
  const transacoes = (resp as { seller_reputation?: { transactions?: { total?: unknown } } } | null)
    ?.seller_reputation?.transactions?.total;
  const info: InfoVendedor = { uf: ufDoVendedor(resp), transacoes_total: typeof transacoes === 'number' ? transacoes : null };
  cache.set(sellerId, info);
  return info;
}

const resultadoVazio = (): ResultadoFicha => ({
  category_id: null, ofertas: 0, preco: null, frete_gratis_pct: 0, visitas_30d: null, visitas_por_dia: [], vendedores: [],
});

async function processarFicha(ficha: FichaBusca, token: string, sellerCache: Map<number, InfoVendedor>): Promise<ResultadoFicha> {
  const ofertasJson = await mlGet(`${API}/products/${ficha.product_id}/items`, token);
  const ofertas = parseOfertasProduto(ofertasJson);
  const naoLidas = ofertasNaoLidas(ofertasJson);
  const freteGratisPct = ofertas.length
    ? Math.round((ofertas.filter((o) => o.frete_gratis).length / ofertas.length) * 100)
    : 0;

  // category_id: /products/{id} não devolve — resolve pelo preditor nativo do ML (já cacheado
  // 30d em _shared/ml/domain-discovery.ts), casando pelo nome da ficha (provado com token real
  // em 17/08 — "Tecido Oxford Liso 10 Metros…" → MLB439096). Vazio/erro → null, não derruba a ficha.
  const [candidatos, visitas] = await Promise.all([
    comTimeout(buscarCategoriaPreditor(token, ficha.nome), 10_000, []),
    resolverVisitas(ofertas, token),
  ]);
  const categoryId = candidatos[0]?.categoriaId ?? null;

  const vendedores: ResultadoFicha['vendedores'] = [];
  const vistos = new Set<number>();
  for (const o of ofertas) {
    if (vistos.has(o.seller_id)) continue;
    vistos.add(o.seller_id);
    const info = await resolverVendedor(o.seller_id, token, sellerCache);
    vendedores.push({ seller_id: o.seller_id, uf: info.uf, transacoes_total: info.transacoes_total, loja_oficial: o.loja_oficial });
  }

  return {
    category_id: categoryId,
    ofertas: ofertas.length + naoLidas,
    preco: resumoPrecos(ofertas.map((o) => o.preco)),
    frete_gratis_pct: freteGratisPct,
    visitas_30d: visitas?.total ?? null,
    visitas_por_dia: visitas?.por_dia ?? [],
    vendedores,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'read' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { termo?: string };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const termo = body.termo ?? '';
  const normalizado = normalizarTermo(termo);
  if (normalizado.length < 3) return json({ erro: 'termo obrigatório (mínimo 3 caracteres)' }, 400);

  const chave = `sonar:v1:MLB:${normalizado}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return json(JSON.parse(cacheado));

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) return json({ erro: 'Conecte o Mercado Livre antes de usar o Sonar.' }, 400);
  const token = await getValidAccessTokenConexao(conexao);

  const busca = await mlGet(`${API}/products/search?status=active&site_id=MLB&q=${encodeURIComponent(normalizado)}&limit=${FICHAS_POR_BUSCA}`, token);
  // null = falha de rede/status (mlGet já tentou 1 retry) — não confundir com busca vazia de
  // verdade (que devolve {paging:{total:0}, results:[]}). Não cachear falha: cache é global e
  // 24h, e um erro transitório do ML travaria o termo vazio para todo mundo até o TTL expirar.
  if (busca === null) return json({ erro: 'Busca no Mercado Livre falhou. Tente de novo.' }, 502);
  const fichas = parseFichasBusca(busca);

  const sellerCache = new Map<number, InfoVendedor>();
  const resultados: ResultadoFicha[] = [];
  for (let i = 0; i < fichas.length; i += LOTE_CONCORRENCIA) {
    const lote = fichas.slice(i, i + LOTE_CONCORRENCIA);
    const settled = await Promise.allSettled(lote.map((f) => processarFicha(f, token, sellerCache)));
    for (const r of settled) resultados.push(r.status === 'fulfilled' ? r.value : resultadoVazio());
  }

  const painel = montarPainelSonar(normalizado, busca, resultados);
  await redisSet(chave, JSON.stringify(painel), CACHE_TTL_S).catch(() => {});
  return json(painel);
});
