import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo, type VincularCatalogoJob } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { vincularVariacoesCatalogo, decidirResultadoRodadaCatalogo } from '../_shared/ml/catalogo.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { montarMensagemCatalogoNoMatch } from '../_shared/notificacoes/telegram.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';

type Job = VincularCatalogoJob;

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
    .select('user_id, org_id, codigo_pai, nome_pai, ml_item_id, ml_permalink, publicado_em').eq('id', job.familia_id).single();
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

    const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');
    if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
    const token = await getValidAccessTokenConexao(conexao);
    const resumo = await vincularVariacoesCatalogo(token, admin, familia.ml_item_id, variacoes);
    console.log(`catálogo (job) ${familia.ml_item_id}: ${JSON.stringify(resumo)}`);

    const tentativaAtual = Number.isInteger(job.tentativa) && (job.tentativa as number) >= 1 ? (job.tentativa as number) : 1;
    const resultado = decidirResultadoRodadaCatalogo(resumo, tentativaAtual);

    if (resultado.acao === 'aguardar_elegibilidade') {
      return new Response(`elegibilidade ainda não computada (${resumo.pendente} pendentes)`, { status: 500, headers: corsHeaders });
    }
    if (resultado.acao === 'reagendar') {
      await enfileirarVinculacaoCatalogo(job.familia_id, resultado.delaySegundos, resultado.proximaTentativa, 2);
      console.log(`catálogo (job) ${familia.ml_item_id}: nao_elegivel na tentativa ${tentativaAtual}, reagendado p/ tentativa ${resultado.proximaTentativa} em +${resultado.delaySegundos}s`);
      return new Response(JSON.stringify({ reagendado: true, proximaTentativa: resultado.proximaTentativa }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // E2 (ADR-0025): opt-in assentou — reflete o estado de catálogo no mapa variacoes_externas
    // (best-effort). Recarrega as variações já com os catalog_* persistidos pelo passo acima.
    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, cor, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', job.familia_id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      org_id: familia.org_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: familia.ml_item_id,
      ml_permalink: familia.ml_permalink ?? null,
      publicado_em: familia.publicado_em ?? null,
    }, varsEspelho ?? []);

    // Alerta proativo (ADR-0036): sobrou variação sem ficha de catálogo equivalente (ficha de kit
    // etc.). Ela não compete e o ML pausa o anúncio depois. Como a ação "Não encontro minha
    // variação" só existe na UI do ML (sem endpoint OAuth), avisa o operador p/ resolver à mão
    // ANTES da pausa. Best-effort: falha de Telegram não derruba o opt-in (que já assentou).
    if (resultado.deveAlertar) {
      try {
        const cores = [...new Set((varsEspelho ?? [])
          .filter((v) => v.catalog_status === 'ficha_divergente' || v.catalog_status === 'sem_produto' || v.catalog_status === 'nao_elegivel')
          .map((v) => (v as { cor?: string | null }).cor)
          .filter((c): c is string => !!c))];
        await notificarCategoria(admin, familia.org_id, 'moderacao',
          montarMensagemCatalogoNoMatch({
            ml_item_id: familia.ml_item_id,
            titulo: familia.nome_pai ?? null,
            cores,
            motivo: resumo.nao_elegivel + resumo.sem_variation_id > 0 && resumo.ficha_divergente === 0 && resumo.sem_produto === 0
              ? 'elegibilidade_esgotada'
              : undefined,
          }));
      } catch (e) {
        console.error(`alerta catálogo no-match falhou para ${familia.ml_item_id}:`, (e as Error).message);
      }
    }

    return new Response(JSON.stringify({ item: familia.ml_item_id, resumo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    // Erro transitório (token/rede) → 500 p/ retry. O passo é best-effort e idempotente.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`vincular-catalogo falhou para ${familia.ml_item_id}:`, msg);
    return new Response(msg, { status: 500, headers: corsHeaders });
  }
});
