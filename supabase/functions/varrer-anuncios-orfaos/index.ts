// Confronta os anúncios VIVOS da conta no ML com tudo que o PubliAI conhece e devolve os que o app
// não conhece — os "órfãos" (incidente 2026-09-10, adendo do ADR-0088: um anúncio criado pelo app e
// depois apagado do banco continuou ativo e vendendo, sem nada no sistema sabendo dele).
//
// SOMENTE LEITURA: nenhuma escrita no ML e nenhuma no banco. Sob demanda (o operador clica), nunca
// em cron — cada execução são ~1 chamada por 100 anúncios mais o multiget.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { listarIdsDoSeller, detalharItens, classificar } from '../_shared/ml/varrer-itens.ts';
import { paginarTudo } from '../_shared/pagina.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

/**
 * Todos os ids de anúncio que o PubliAI conhece nesta org, das 4 fontes que os guardam.
 *
 * PAGINADO, e isso é o ponto: o PostgREST corta em ~1000 linhas SEM avisar, e tanto `familias`
 * (uma linha por ciclo de UPDATE) quanto `anuncios_externos_itens` (uma por SKU) passam disso numa
 * org madura. A linha 1001 viraria "id desconhecido" e o anúncio legítimo apareceria como órfão —
 * fail-OPEN travestido de fail-closed (achado da revisão do Fable). `paginarTudo` também lança em
 * erro de página, então uma fonte incompleta derruba a varredura em vez de inventar órfão.
 */
async function idsConhecidos(admin: ReturnType<typeof adminClient>, orgId: string): Promise<Set<string>> {
  const conhecidos = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v) conhecidos.add(v); };

  // Escritas uma a uma (e não num laço sobre nomes de tabela) porque `select` com string dinâmica
  // apaga a inferência do supabase-js e o tipo do retorno vira `GenericStringError[]`.
  const familias = await paginarTudo<{ ml_item_id: string | null }>((de, ate) =>
    admin.from('familias').select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null).range(de, ate));
  for (const l of familias) add(l.ml_item_id);

  const externos = await paginarTudo<{ item_externo_id: string | null }>((de, ate) =>
    admin.from('anuncios_externos').select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null).range(de, ate));
  for (const l of externos) add(l.item_externo_id);

  const itens = await paginarTudo<{ item_externo_id: string | null }>((de, ate) =>
    admin.from('anuncios_externos_itens').select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null).range(de, ate));
  for (const l of itens) add(l.item_externo_id);

  const kits = await paginarTudo<{ ml_item_id: string | null }>((de, ate) =>
    admin.from('kits_virtuais').select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null).range(de, ate));
  for (const l of kits) add(l.ml_item_id);

  // ANÚNCIO DE CATÁLOGO (ADR-0021 / ADR-0088 F2). O ML cria um item PRÓPRIO, com MLB próprio, a
  // partir do anúncio do app — herdando inclusive o `seller_custom_field`. Sem estas duas fontes a
  // varredura acusa como "órfão" todo anúncio de catálogo saudável da conta: foi o falso alarme de
  // 2026-09-10, em que 10 de 13 "fantasmas" eram catálogo `vinculado`. `catalog_product_id` NÃO
  // entra: é id de FICHA, não de anúncio.
  const catalogoLegacy = await paginarTudo<{ catalog_listing_id: string | null }>((de, ate) =>
    admin.from('variacoes').select('catalog_listing_id, familias!inner(org_id)')
      .eq('familias.org_id', orgId).not('catalog_listing_id', 'is', null).range(de, ate));
  for (const l of catalogoLegacy) add(l.catalog_listing_id);

  const catalogoUP = await paginarTudo<{ catalog_listing_id: string | null }>((de, ate) =>
    admin.from('anuncios_externos_itens').select('catalog_listing_id').eq('org_id', orgId)
      .not('catalog_listing_id', 'is', null).range(de, ate));
  for (const l of catalogoUP) add(l.catalog_listing_id);

  // Migração para preço por variação (ADR-0161): o item antigo normalmente vira `closed`, mas uma
  // migração parada em `_pending` deixa ele ATIVO — e ele é conhecido, não órfão.
  const anteriores = await paginarTudo<{ ml_item_id_anterior: string | null }>((de, ate) =>
    admin.from('anuncios_externos').select('ml_item_id_anterior').eq('org_id', orgId)
      .not('ml_item_id_anterior', 'is', null).range(de, ate));
  for (const l of anteriores) add(l.ml_item_id_anterior);

  return conhecidos;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao?.contaExternaId) return json({ error: 'Organização sem conexão com o Mercado Livre.' }, 400);

  try {
    const token = await getValidAccessTokenConexao(conexao);
    const sellerId = conexao.contaExternaId;

    // Só `active` e `paused`: anúncio encerrado não vende e listá-lo encheria a varredura de
    // histórico — além de estourar o teto de 1000 do search em conta antiga.
    const [ativos, pausados] = await Promise.all([
      listarIdsDoSeller(fetch, token, sellerId, 'active'),
      listarIdsDoSeller(fetch, token, sellerId, 'paused'),
    ]);
    const truncado = ativos.truncado || pausados.truncado;
    const todos = [...new Set([...ativos.ids, ...pausados.ids])];

    const conhecidos = await idsConhecidos(admin, orgId);
    const desconhecidos = todos.filter((id) => !conhecidos.has(id));
    if (desconhecidos.length === 0) {
      return json({ orfaos: [], total_no_ml: todos.length, truncado });
    }

    const detalhes = await detalharItens(fetch, token, desconhecidos);
    return json({
      orfaos: detalhes.map((i) => ({
        ml_item_id: i.id, titulo: i.titulo, status: i.status,
        permalink: i.permalink, estoque: i.estoque, sku: i.sku,
        classe: classificar(i),
        // Pausado com código do app é, quase sempre, resultado ESPERADO de "Remover" — que pausa no
        // ML e zera o vínculo de propósito (remover-publicado). Marcar aqui evita que a tela
        // apresente como pendência algo que o próprio operador mandou fazer.
        provavel_remocao_pelo_app: i.status === 'paused' && classificar(i) === 'perdido_do_app',
      })),
      total_no_ml: todos.length,
      truncado,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('varrer-anuncios-orfaos falhou:', msg);
    return json({ error: `Não foi possível varrer os anúncios: ${msg}` }, 502);
  }
});
