import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { vincularVariacoesCatalogo } from '../_shared/ml/catalogo.ts';

interface Job { familia_id: string; }

// Worker do opt-in de catálogo (ADR-0021), deferido via QStash. A elegibilidade de catálogo do
// ML só fica pronta minutos após o CREATE; este job roda com delay e, enquanto a elegibilidade
// não estiver computada (variações `pendente`), devolve 500 para o QStash retentar.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: Job;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

  const admin = adminClient();
  const { data: familia } = await admin.from('familias')
    .select('user_id, ml_item_id').eq('id', job.familia_id).single();
  // Sem item publicado não há o que vincular (família removida/erro) — encerra sem retry.
  if (!familia?.ml_item_id) {
    return new Response(JSON.stringify({ skip: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('id, codigo, gtin, ml_variation_id, catalog_product_id, catalog_listing_id')
      .eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) {
      return new Response(JSON.stringify({ skip: true, motivo: 'sem variações' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const token = await getValidAccessToken(familia.user_id);
    const resumo = await vincularVariacoesCatalogo(token, admin, familia.ml_item_id, variacoes);
    console.log(`catálogo (job) ${familia.ml_item_id}: ${JSON.stringify(resumo)}`);

    // Elegibilidade ainda não computada pelo ML → relança para o QStash retentar com backoff.
    if (resumo.pendente > 0) {
      return new Response(`elegibilidade ainda não computada (${resumo.pendente} pendentes)`, { status: 500, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ item: familia.ml_item_id, resumo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    // Erro transitório (token/rede) → 500 p/ retry. O passo é best-effort e idempotente.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`vincular-catalogo falhou para ${familia.ml_item_id}:`, msg);
    return new Response(msg, { status: 500, headers: corsHeaders });
  }
});
