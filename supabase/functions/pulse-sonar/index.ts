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
import { montarPainelSonar, parseDateCreatedMultiget, parseFichasBusca, parseVisitasJanela, resumoPrecos, sondaDeveDesligar, type FichaBusca, type OutcomeLoteSonda, type ResultadoFicha } from '../_shared/pulse/sonar.ts';

const API = 'https://api.mercadolibre.com';
const FICHAS_POR_BUSCA = 40; // ponytail: teto fixo; paginação "carregar mais" quando provar demanda.
// Dobrado de 20 — o topo do /products/search vem cheio de ficha sem vendedor ativo (404 "No
// winners found" em /products/{id}/items); fichas vazias são baratas (curto-circuitam antes de
// categoria/visitas/vendedores), então o dobro de fichas não dobra o volume de chamadas ao ML.
const LOTE_CONCORRENCIA = 5; // teto de fichas em paralelo, para não estourar rate limit do ML
const CACHE_TTL_S = 24 * 60 * 60; // dado público; chave global sem org_id (ADR-0120 §3)
// Sonda de Grupo C (D9/ADR-0125): se o multiget `/items?ids=...&date_created` devolver 403 (a
// aposta do ADR é que passe, como já passa para itens PRÓPRIOS em pulse-coletar), a flag desliga
// a sonda por 24h — sem ela, todo garimpo bateria de novo numa hipótese já provada errada.
const FLAG_MULTIGET_403 = 'sonar:items-multiget-403';
const FLAG_MULTIGET_403_TTL_S = 24 * 60 * 60;
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

// Item mais barato da ficha (proxy do ganhador) — usado tanto nas visitas (abaixo) quanto na
// sonda de `criado_em` (D9/ADR-0125), sempre o MESMO item para as duas medições.
function itemMaisBarato(ofertas: OfertaColetada[]): OfertaColetada | null {
  if (ofertas.length === 0) return null;
  return ofertas.reduce((min, o) => (o.preco < min.preco ? o : min));
}

// Visitas: só o item MAIS BARATO da ficha. Multiget não serve — "maximum amount of items to
// query is 1" (testado 17/08).
async function resolverVisitas(maisBarato: OfertaColetada | null, token: string) {
  if (!maisBarato) return null;
  const resp = await mlGet(`${API}/items/${maisBarato.item_id}/visits/time_window?last=30&unit=day`, token);
  return parseVisitasJanela(resp);
}

// Sonda de Grupo C (D9/ADR-0125): a decisão de desligar (todos os lotes 403, nenhuma falha
// transitória misturada) é a função pura `sondaDeveDesligar` (testada em sonar.test.ts) — aqui só
// classifica cada lote. `fetch` LOCAL (não `mlGet`, que engolia o status) com status inspecionado,
// como o coletor do Pulse já faz para itens PRÓPRIOS (`pulse-coletar/processar.ts`).
async function sondarCriadoEm(ids: string[], token: string): Promise<{ mapa: Map<string, string>; forbidden: boolean }> {
  const mapa = new Map<string, string>();
  const outcomes: OutcomeLoteSonda[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    let resp: Response;
    try {
      resp = await fetch(`${API}/items?ids=${lote.join(',')}&attributes=id,date_created`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      outcomes.push('transitoria'); // timeout/rede: não prova nada sobre a hipótese
      continue;
    }
    if (resp.status === 403) { outcomes.push('forbidden'); continue; }
    if (!resp.ok) { outcomes.push('transitoria'); continue; } // 5xx etc: transitório
    const json = await resp.json().catch(() => null);
    const envelopes = Array.isArray(json) ? json : [];
    if (envelopes.length > 0 && envelopes.every((e) => (e as { code?: unknown })?.code === 403)) {
      outcomes.push('forbidden');
      continue;
    }
    outcomes.push('ok');
    for (const [id, dataCreated] of parseDateCreatedMultiget(json)) mapa.set(id, dataCreated);
  }
  return { mapa, forbidden: sondaDeveDesligar(outcomes) };
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
  category_id: null, ofertas: 0, preco: null, frete_gratis_pct: 0, visitas_30d: null, visitas_por_dia: [], vendedores: [], item_ids: [], criado_em: null,
});

interface FichaProcessada {
  resultado: ResultadoFicha;
  /** item_id do mesmo item mais barato cujas visitas foram medidas — candidato da sonda de Grupo
   *  C (D9/ADR-0125), resolvido só depois de TODAS as fichas prontas (lotes de 20, fora do loop
   *  de concorrência de 5). null = ficha sem oferta. */
  itemVisitasId: string | null;
}

async function processarFicha(ficha: FichaBusca, token: string, sellerCache: Map<number, InfoVendedor>): Promise<FichaProcessada> {
  const ofertasJson = await mlGet(`${API}/products/${ficha.product_id}/items`, token);
  const ofertas = parseOfertasProduto(ofertasJson);
  // Ficha sem vendedor ativo (404 "No winners found" ou results: [] mesmo com 200): não vale
  // gastar categoria/visitas/vendedores nela. Entra no painel como "sem vendedor ativo".
  if (ofertas.length === 0) return { resultado: resultadoVazio(), itemVisitasId: null };

  const naoLidas = ofertasNaoLidas(ofertasJson);
  const freteGratisPct = ofertas.length
    ? Math.round((ofertas.filter((o) => o.frete_gratis).length / ofertas.length) * 100)
    : 0;
  const maisBarato = itemMaisBarato(ofertas);

  // category_id: /products/{id} não devolve — resolve pelo preditor nativo do ML (já cacheado
  // 30d em _shared/ml/domain-discovery.ts), casando pelo nome da ficha (provado com token real
  // em 17/08 — "Tecido Oxford Liso 10 Metros…" → MLB439096). Vazio/erro → null, não derruba a ficha.
  const [candidatos, visitas] = await Promise.all([
    comTimeout(buscarCategoriaPreditor(token, ficha.nome), 10_000, []),
    resolverVisitas(maisBarato, token),
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
    resultado: {
      category_id: categoryId,
      ofertas: ofertas.length + naoLidas,
      preco: resumoPrecos(ofertas.map((o) => o.preco)),
      frete_gratis_pct: freteGratisPct,
      visitas_30d: visitas?.total ?? null,
      visitas_por_dia: visitas?.por_dia ?? [],
      vendedores,
      item_ids: ofertas.map((o) => o.item_id),
      criado_em: null, // preenchido depois do loop pela sonda (ou fica null se desligada/falhar)
    },
    itemVisitasId: maisBarato?.item_id ?? null,
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

  // v2: bump por causa da mudança de comportamento nas fichas sem vendedor ativo — um resultado
  // v1 já cacheado para o termo de teste ficaria servindo o shape antigo por até 24h.
  // v3 (ADR-0125/D3): ResultadoFicha ganhou `item_ids`, obrigatório para o cruzamento
  // ficha↔anúncio (D4) — sem bump, um painel v2 cacheado serviria fichas sem item_ids por 24h.
  // Bump aqui é grátis (API oficial, sem custo monetário Apify).
  // `criado_em` (D9, Grupo C) entrou DEPOIS na mesma v3, sem bump novo: campo aditivo (mesma
  // regra do D2 aplicada aqui) — painel v3 cacheado antes desta sonda simplesmente não tem o
  // campo até o TTL de 24h expirar sozinho, e o front já trata `criado_em` como opcional.
  const chave = `sonar:v3:MLB:${normalizado}`;
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
  const itemVisitasIds: Array<string | null> = [];
  for (let i = 0; i < fichas.length; i += LOTE_CONCORRENCIA) {
    const lote = fichas.slice(i, i + LOTE_CONCORRENCIA);
    const settled = await Promise.allSettled(lote.map((f) => processarFicha(f, token, sellerCache)));
    for (const r of settled) {
      if (r.status === 'fulfilled') { resultados.push(r.value.resultado); itemVisitasIds.push(r.value.itemVisitasId); }
      else { resultados.push(resultadoVazio()); itemVisitasIds.push(null); }
    }
  }

  // Sonda de Grupo C (D9/ADR-0125): só roda se a flag 403 não estiver ligada. Lotes de 20 ids,
  // fora do loop de concorrência de 5 acima (é uma chamada por garimpo, não por ficha).
  const flagDesligada = await redisGet(FLAG_MULTIGET_403).catch(() => null);
  if (!flagDesligada) {
    const idsSonda = itemVisitasIds.filter((id): id is string => id != null);
    if (idsSonda.length > 0) {
      const { mapa, forbidden } = await sondarCriadoEm(idsSonda, token);
      if (forbidden) await redisSet(FLAG_MULTIGET_403, '1', FLAG_MULTIGET_403_TTL_S).catch(() => {});
      resultados.forEach((r, i) => {
        const id = itemVisitasIds[i];
        if (id) r.criado_em = mapa.get(id) ?? null;
      });
    }
  }

  const painel = montarPainelSonar(normalizado, busca, resultados);
  await redisSet(chave, JSON.stringify(painel), CACHE_TTL_S).catch(() => {});
  return json(painel);
});
