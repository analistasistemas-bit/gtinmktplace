// ADR-0154 Decisão 12: lista candidatos a componente de Kit Virtual — busca no ML
// (`POST /users/$SELLER_ID/kits/components/search`) enriquecida com o catálogo local
// (codigo/custo/origem/kit_multiplicador). Admin-only (mesmo gate de criar-kit-vinculado/
// index.ts), read-only e idempotente: não escreve nada.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  buscarComponentesKitVirtual, parsePaginaML,
  type BuscarComponentesDeps, type CatalogoLocalItem, type ComponenteEnriquecido, type ItemBridge,
} from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const API = 'https://api.mercadolibre.com';

// ─── Deps reais: ML ─────────────────────────────────────────────────────────

async function buscarPaginaML(
  token: string, sellerId: string, searchText: string | undefined, searchAfterHash: string | null,
): Promise<ReturnType<typeof parsePaginaML>> {
  const params = new URLSearchParams({ limit: '50' });
  if (searchText) params.set('searchText', searchText);
  const body: Record<string, unknown> = { active_channels: ['marketplace'] };
  if (searchAfterHash) body.paging = { search_after_hash: searchAfterHash };

  const resp = await fetch(`${API}/users/${sellerId}/kits/components/search?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(body),
  });
  const respJson = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`ML kits/components/search ${resp.status}: ${JSON.stringify(respJson)}`);
  return parsePaginaML(respJson);
}

// Multiget em lotes de 20 (limite do ML), mesmo padrão de _shared/ml/pedidos.ts:buscarGtinsDosItens
// — bloco que falha é ignorado (aqueles itens locais só não entram na ponte, não derrubam a busca).
// `price`/`category_id` viajam no MESMO multiget (Gap 1 do plano de entrega): preview-kit-virtual
// exige os dois por componente, e esta é a fonte confiável (service_role, org-scoped) pra eles —
// nunca o catálogo local, que não guarda preço nem categoria do ML.
async function buscarUserProductIdsML(token: string, itemIds: string[]): Promise<ItemBridge[]> {
  const out: ItemBridge[] = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    const bloco = itemIds.slice(i, i + 20);
    const url = `${API}/items?ids=${bloco.join(',')}&attributes=id,user_product_id,price,category_id`;
    const arr = await mlGet(url, token);
    if (!Array.isArray(arr)) continue;
    for (const entry of arr as {
      code?: number;
      body?: { id?: string; user_product_id?: string | null; price?: number | null; category_id?: string | null };
    }[]) {
      if (entry?.code !== 200 || !entry.body?.id) continue;
      out.push({
        itemId: entry.body.id,
        userProductId: entry.body.user_product_id ?? null,
        precoAtualML: typeof entry.body.price === 'number' ? entry.body.price : null,
        categoriaMlId: entry.body.category_id ?? null,
      });
    }
  }
  return out;
}

// ─── Deps reais: catálogo local ────────────────────────────────────────────

async function listarItemIdsLocais(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const [{ data: fams }, { data: itens }] = await Promise.all([
    admin.from('familias').select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null),
    admin.from('anuncios_externos_itens').select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null),
  ]);
  const ids = new Set<string>();
  for (const f of (fams ?? []) as { ml_item_id: string | null }[]) if (f.ml_item_id) ids.add(f.ml_item_id);
  for (const it of (itens ?? []) as { item_externo_id: string | null }[]) if (it.item_externo_id) ids.add(it.item_externo_id);
  return [...ids];
}

/**
 * Catálogo local dos item_ids que casaram na ponte, pelos dois caminhos que um user product
 * nativo pode ter vindo (D-12): família legacy single-item (`familias.ml_item_id`) ou item
 * plano do ADR-0088 (`anuncios_externos_itens.item_externo_id`). `codigo`/`custo` só saem
 * preenchidos quando a família tem exatamente 1 variação — item com `variations[]` no ML nunca
 * chega aqui, porque não tem `user_product_id` de item pra casar na ponte.
 */
async function buscarCatalogoLocal(admin: SupabaseClient, orgId: string, itemIds: string[]): Promise<CatalogoLocalItem[]> {
  if (itemIds.length === 0) return [];
  const catalogo: CatalogoLocalItem[] = [];

  // Caminho A: família legacy single-item.
  const { data: fams } = await admin.from('familias')
    .select('id, codigo_pai, origem, kit_multiplicador, ml_item_id')
    .eq('org_id', orgId).in('ml_item_id', itemIds) as {
      data: { id: string; codigo_pai: string; origem: 'nacional' | 'importado'; kit_multiplicador: number | null; ml_item_id: string }[] | null;
    };
  const familiaIds = (fams ?? []).map((f) => f.id);
  const { data: variacoesFam } = familiaIds.length
    ? await admin.from('variacoes').select('familia_id, codigo, custo').eq('org_id', orgId).in('familia_id', familiaIds) as {
      data: { familia_id: string; codigo: string; custo: number | null }[] | null;
    }
    : { data: [] };
  const variacoesPorFamilia = new Map<string, { codigo: string; custo: number | null }[]>();
  for (const v of variacoesFam ?? []) {
    const arr = variacoesPorFamilia.get(v.familia_id) ?? [];
    arr.push({ codigo: v.codigo, custo: v.custo });
    variacoesPorFamilia.set(v.familia_id, arr);
  }
  for (const f of fams ?? []) {
    // Best-effort (D-12): só atribui codigo/custo quando a família tem exatamente 1 variação.
    const vs = variacoesPorFamilia.get(f.id) ?? [];
    const unica = vs.length === 1 ? vs[0] : null;
    catalogo.push({
      itemId: f.ml_item_id, codigo: unica?.codigo ?? null, codigoPai: f.codigo_pai,
      custo: unica?.custo ?? null, origem: f.origem, kitMultiplicador: f.kit_multiplicador,
    });
  }

  // Caminho B: item plano (ADR-0088).
  const { data: itens } = await admin.from('anuncios_externos_itens')
    .select('item_externo_id, sku, anuncio_externo_id, variacao_id')
    .eq('org_id', orgId).in('item_externo_id', itemIds) as {
      data: { item_externo_id: string; sku: string; anuncio_externo_id: string; variacao_id: string | null }[] | null;
    };
  const anuncioIds = [...new Set((itens ?? []).map((i) => i.anuncio_externo_id))];
  const variacaoIds = [...new Set((itens ?? []).map((i) => i.variacao_id).filter((v): v is string => !!v))];
  const { data: anuncios } = anuncioIds.length
    ? await admin.from('anuncios_externos').select('id, codigo_pai').eq('org_id', orgId).in('id', anuncioIds) as {
      data: { id: string; codigo_pai: string }[] | null;
    }
    : { data: [] };
  const { data: variacoesItem } = variacaoIds.length
    ? await admin.from('variacoes').select('id, custo, familia_id').eq('org_id', orgId).in('id', variacaoIds) as {
      data: { id: string; custo: number | null; familia_id: string }[] | null;
    }
    : { data: [] };
  const familiaIdsItem = [...new Set((variacoesItem ?? []).map((v) => v.familia_id))];
  const { data: familiasItem } = familiaIdsItem.length
    ? await admin.from('familias').select('id, origem, kit_multiplicador').eq('org_id', orgId).in('id', familiaIdsItem) as {
      data: { id: string; origem: 'nacional' | 'importado'; kit_multiplicador: number | null }[] | null;
    }
    : { data: [] };

  const codigoPaiPorAnuncio = new Map((anuncios ?? []).map((a) => [a.id, a.codigo_pai]));
  const variacaoPorId = new Map((variacoesItem ?? []).map((v) => [v.id, v]));
  const familiaPorId = new Map((familiasItem ?? []).map((f) => [f.id, f]));

  for (const it of itens ?? []) {
    const variacao = it.variacao_id ? variacaoPorId.get(it.variacao_id) : undefined;
    const familia = variacao ? familiaPorId.get(variacao.familia_id) : undefined;
    catalogo.push({
      itemId: it.item_externo_id,
      codigo: it.sku,
      codigoPai: codigoPaiPorAnuncio.get(it.anuncio_externo_id) ?? null,
      custo: variacao?.custo ?? null,
      origem: familia?.origem ?? null,
      kitMultiplicador: familia?.kit_multiplicador ?? null,
    });
  }

  return catalogo;
}

// ─── HTTP handler ───────────────────────────────────────────────────────────

function toWire(c: ComponenteEnriquecido) {
  return {
    user_product_id: c.userProductId,
    item_id: c.itemId,
    title: c.title,
    type: c.type,
    thumbnail_url: c.thumbnailUrl,
    category_name: c.categoryName,
    estoque: c.estoque,
    reasons: c.reasons,
    codigo: c.codigo,
    codigo_pai: c.codigoPai,
    custo: c.custo,
    origem: c.origem,
    kit_multiplicador: c.kitMultiplicador,
    preco_atual_ml: c.precoAtualML,
    categoria_ml_id: c.categoriaMlId,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = context;

  const admin = adminClient();

  // Gate admin (D-7/ADR-0060), mesmo padrão de criar-kit-vinculado/index.ts:96-101.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }

  let body: { search_text?: unknown } = {};
  try { body = await req.json(); } catch { /* corpo vazio é válido — busca sem filtro */ }
  const searchText = typeof body.search_text === 'string' && body.search_text.trim() ? body.search_text.trim() : undefined;

  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao || !conexao.contaExternaId) {
    return json({ error: 'Organização sem conexão com o Mercado Livre', motivo: 'sem_conexao_ml' }, 409);
  }
  const sellerId = conexao.contaExternaId;

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch (e) {
    console.error('buscar_componentes_kit_virtual_token_falhou', { orgId, erro: String(e) });
    return json({ error: 'Falha ao renovar credencial do Mercado Livre' }, 502);
  }

  const deps: BuscarComponentesDeps = {
    buscarPagina: (hash) => buscarPaginaML(token, sellerId, searchText, hash),
    listarItemIdsLocais: () => listarItemIdsLocais(admin, orgId),
    buscarUserProductIds: (itemIds) => buscarUserProductIdsML(token, itemIds),
    buscarCatalogoLocal: (itemIds) => buscarCatalogoLocal(admin, orgId, itemIds),
  };

  try {
    const resultado = await buscarComponentesKitVirtual(deps);
    return json({
      ok: true,
      elegiveis: resultado.elegiveis.map(toWire),
      inelegiveis: resultado.inelegiveis.map(toWire),
    });
  } catch (e) {
    console.error('buscar_componentes_kit_virtual_falhou', { orgId, erro: String(e) });
    return json({ error: 'Falha ao buscar componentes no Mercado Livre' }, 502);
  }
});
