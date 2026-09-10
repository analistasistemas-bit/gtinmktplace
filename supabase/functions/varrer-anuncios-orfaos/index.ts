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
import { listarIdsDoSeller, detalharItens } from '../_shared/ml/varrer-itens.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

/** Todos os ids de anúncio que o PubliAI conhece nesta org, das 4 fontes que os guardam. */
async function idsConhecidos(admin: ReturnType<typeof adminClient>, orgId: string): Promise<Set<string>> {
  const conhecidos = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v) conhecidos.add(v); };

  const [familias, externos, itens, kits] = await Promise.all([
    admin.from('familias').select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null),
    admin.from('anuncios_externos').select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null),
    admin.from('anuncios_externos_itens').select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null),
    admin.from('kits_virtuais').select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null),
  ]);
  // Fail-closed: uma fonte que falhou tornaria seus anúncios "desconhecidos" e o operador veria
  // dezenas de falsos órfãos — pior que não responder.
  for (const [nome, r] of [['familias', familias], ['anuncios_externos', externos],
    ['anuncios_externos_itens', itens], ['kits_virtuais', kits]] as const) {
    if (r.error) throw new Error(`varredura: consultar ${nome} falhou: ${r.error.message}`);
    for (const linha of (r.data ?? []) as Array<Record<string, unknown>>) {
      add(linha.ml_item_id ?? linha.item_externo_id);
    }
  }
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
