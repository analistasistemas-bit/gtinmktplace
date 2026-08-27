// Sonar — busca por EAN/GTIN (ADR-0127 Errata 1): par das pulse-sonar-vendas/visitas, edge
// separada de propósito — o lookup oficial do catálogo é grátis e único produto (não nicho); o
// bloco pago (Apify) é opt-in do operador e sua falha degrada só esse pedaço, nunca o resto.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { buscarPerfilVendedor } from '../_shared/ml/perfil-vendedor.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { apifyConfigurado, buscarAnunciosML } from '../_shared/apify/client.ts';
import { parseItensApify, type ItemVendas } from '../_shared/pulse/sonar-vendas.ts';
import {
  aplicarPrecoVencedorCatalogo, parseDescricaoCatalogo, parseItensProduto, parseProdutosBusca,
} from '../_shared/concorrencia/parse.ts';
import { montarRespostaEan, validarEan } from '../_shared/pulse/sonar-ean.ts';
import type { FichaEan } from '../_shared/pulse/sonar-ean.ts';

// Teto de fichas por EAN (ADR-0136 D-1): medição do caso real deu 2, nenhum EAN de teste passou
// de 3 — acima disso o custo de fan-out não se paga. Fichas descartadas pelo teto são contadas em
// `fichas_encontradas`, nunca cortadas em silêncio.
const TETO_FICHAS = 5;

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
  product_id: string | null; // primeira ficha; null = tombstone: EAN sem ficha de catálogo, não rebusca
  nome_produto: string | null;
  descricao_catalogo: string | null;
  /** Categoria do produto, lida das ofertas. É o que destrava o cálculo de "quanto você recebe"
   *  no cliente (`calcular-tarifa-ml`) — `parseItensProduto` sempre calculou e a Errata 1
   *  descartava. Foi por causa dele que a chave subiu para v2. */
  categoria_ml_id: string | null;
  /** nickname por seller_id, resolvido uma vez por vendedor distinto: a lookup de catálogo não
   *  traz nome, e `780167992` não diz nada a quem está decidindo se entra no produto. */
  vendedores: Record<string, string>;
  /** Todas as fichas do EAN que responderam (ADR-0136 D-1), até o teto. */
  fichas: FichaEan[];
  /** Quantas o `/products/search` retornou, antes do teto (ADR-0136 D-3). */
  fichas_encontradas: number;
}

/**
 * Nome de cada vendedor distinto (1 chamada por seller, não por oferta). Vendedor sem perfil
 * legível fica de fora do mapa e a UI cai no id — perder o nome não pode derrubar a consulta,
 * então falha individual é ignorada de propósito.
 */
async function resolverNomesVendedores(
  sellerIds: number[],
  token: string,
): Promise<Record<string, string>> {
  // Teto de 5 simultâneas (o mesmo da pulse-sonar-visitas): com uma ficha só a lista de vendedores
  // era curta e o `Promise.all` solto passava, mas a união de até 5 fichas (ADR-0136) multiplica o
  // fan-out e derrubaria a consulta inteira por rate limit do ML — por um dado cosmético.
  const perfis = await pool(5, sellerIds, (id) => buscarPerfilVendedor(token, id).catch(() => null));
  const mapa: Record<string, string> = {};
  for (const p of perfis) {
    if (p?.nickname) mapa[String(p.seller_id)] = p.nickname;
  }
  return mapa;
}

/** `null` = falha transitória do ML (timeout/5xx) — NUNCA cacheia, distingue de "EAN sem
 *  ficha" (HTTP 200 com `results` vazio, isso sim é tombstone válido). Mesma regra da
 *  pulse-sonar-visitas: erro transitório não pode travar a resposta por 24h com afirmação falsa. */
async function resolverLookup(ean: string, token: string): Promise<LookupCache | null> {
  // v3 (ADR-0136): o shape trocou "uma ficha" por "lista de fichas". v2 não é migrável — shape
  // diferente — então a chave sobe em vez de tentar completar o que não foi lido.
  const chave = `sonar:ean:v3:${ean}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return JSON.parse(cacheado);

  const busca = await mlGet(
    `${API}/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(ean)}`,
    token,
  );
  if (busca === null) return null; // falha do ML, não "sem ficha"
  const produtos = parseProdutosBusca(busca);
  if (produtos.length === 0) {
    const tombstone: LookupCache = {
      product_id: null, nome_produto: null, descricao_catalogo: null,
      categoria_ml_id: null, vendedores: {}, fichas: [], fichas_encontradas: 0,
    };
    await redisSet(chave, JSON.stringify(tombstone), CACHE_TTL_LOOKUP_S).catch(() => {});
    return tombstone;
  }

  const fichasEncontradas = produtos.length;
  const candidatas = produtos.slice(0, TETO_FICHAS);
  const resolvidas = await Promise.all(candidatas.map(async (produto) => {
    const [produtoJson, itensJson] = await Promise.all([
      mlGet(`${API}/products/${produto.id}`, token),
      mlGet(`${API}/products/${produto.id}/items`, token),
    ]);
    // `itensJson` é a lista de ofertas — se o ML falhou em devolvê-la, `parseItensProduto` cairia
    // no shape vazio e trataria "sem ofertas ativas" como dado confirmado. `produtoJson` nulo é
    // tolerável (só perde o preço vencedor/descrição do catálogo dessa ficha,
    // `aplicarPrecoVencedorCatalogo` já degrada sozinho para esse caso). Ficha que falhou sai da
    // lista — as demais seguem (ADR-0136 D-1).
    if (itensJson === null) return null;
    // buy_box_winner é POR FICHA — aplicar o de uma em outra corromperia o preço.
    const itensComPrecos = aplicarPrecoVencedorCatalogo(itensJson, produtoJson);
    const dadosOfertas = parseItensProduto(itensComPrecos);
    return {
      ficha: { product_id: produto.id, nome: produto.nome, ofertas: dadosOfertas.ofertas_detalhe } as FichaEan,
      descricao_catalogo: parseDescricaoCatalogo(produtoJson),
      categoria_ml_id: dadosOfertas.category_id,
      seller_ids: dadosOfertas.seller_ids,
    };
  }));
  const ok = resolvidas.filter((r): r is NonNullable<typeof r> => r !== null);
  // Todas as fichas falharam: mesmo comportamento de hoje (nula → 502), não uma resposta parcial vazia.
  if (ok.length === 0) return null;

  const fichas = ok.map((r) => r.ficha);
  const sellerIdsUnicos = [...new Set(ok.flatMap((r) => r.seller_ids))];
  const lookup: LookupCache = {
    product_id: fichas[0].product_id,
    nome_produto: fichas[0].nome,
    // Mesmo critério de `product_id`/`nome_produto`: primeira ficha (comportamento histórico).
    descricao_catalogo: ok[0].descricao_catalogo,
    // Exceção explícita do ADR: categoria vem da 1ª ficha que TROUXER o campo, não da 1ª ficha —
    // sem isso uma ficha sem categoria na frente apagaria o dado que outra ficha tem.
    categoria_ml_id: ok.find((r) => r.categoria_ml_id)?.categoria_ml_id ?? null,
    vendedores: await resolverNomesVendedores(sellerIdsUnicos, token),
    fichas,
    fichas_encontradas: fichasEncontradas,
  };
  // Não cachear resultado parcial: se UMA ficha falhou (transitório do ML), a resposta ainda sai
  // (as fichas que responderam valem), mas gravar isso por 24h congelaria uma cobertura menor que
  // a real assim que o ML voltar — o mesmo bug que o comentário de `itensJson === null` acima já
  // evita para o caso de ficha única, reintroduzido em escala menor pelo multi-ficha.
  if (ok.length === candidatas.length) {
    await redisSet(chave, JSON.stringify(lookup), CACHE_TTL_LOOKUP_S).catch(() => {});
  }
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
    fichas: lookup.fichas,
    fichasEncontradas: lookup.fichas_encontradas,
    descricaoCatalogo: lookup.descricao_catalogo,
    categoriaMlId: lookup.categoria_ml_id,
    nomesVendedores: lookup.vendedores,
    comVendas: itensApify !== null,
    vendasIndisponivel,
    itensApify,
    geradoEm: new Date().toISOString(),
  }));
});
