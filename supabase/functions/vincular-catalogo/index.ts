import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo, type VincularCatalogoJob } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { decidirResultadoRodadaCatalogo, decidirMotivoAlertaCatalogo, normalizarTentativaCatalogo } from '../_shared/ml/catalogo.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { montarMensagemCatalogoNoMatch } from '../_shared/notificacoes/telegram.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { rodarVinculacaoCatalogo, type FilhoCatalogoUP } from './vinculacao.ts';

type Job = VincularCatalogoJob;
const CANAL = 'mercado_livre';

// Cores das cores (itens) UP sem ficha equivalente, para o alerta no-match (ADR-0036). Re-lê o
// catalog_status persistido pela vinculação e mapeia sku→cor a partir dos filhos já carregados.
const NO_MATCH = new Set(['ficha_divergente', 'sem_produto', 'nao_elegivel']);
async function coresNoMatchUP(admin: ReturnType<typeof adminClient>, familia: { org_id: string; codigo_pai: string }, filhos: FilhoCatalogoUP[]): Promise<string[]> {
  const { data: raizes } = await admin.from('anuncios_externos')
    .select('id').eq('org_id', familia.org_id).eq('codigo_pai', familia.codigo_pai).eq('canal', CANAL);
  const rootIds = (raizes ?? []).map((r: { id: string }) => r.id);
  if (rootIds.length === 0) return [];
  const { data: itens } = await admin.from('anuncios_externos_itens')
    .select('sku, catalog_status').in('anuncio_externo_id', rootIds).eq('retirado', false);
  const corPorSku = new Map(filhos.map((f) => [f.sku, f.cor]));
  return [...new Set((itens ?? [])
    .filter((i: { catalog_status: string | null }) => i.catalog_status != null && NO_MATCH.has(i.catalog_status))
    .map((i: { sku: string }) => corPorSku.get(i.sku))
    .filter((c): c is string => !!c))];
}

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
    const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');
    if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
    const token = await getValidAccessTokenConexao(conexao);

    // ADR-0088 F2: roteia por presença de itens filhos UP. Família UP → vincula por item
    // (anuncios_externos_itens); Legacy → por variação (variacoes), exatamente como antes.
    const familiaVinc = { id: job.familia_id, org_id: familia.org_id, codigo_pai: familia.codigo_pai, ml_item_id: familia.ml_item_id };
    const vinc = await rodarVinculacaoCatalogo(admin, token, familiaVinc, CANAL);
    if (vinc.tipo === 'sem_variacoes') {
      return new Response(JSON.stringify({ skip: true, motivo: 'sem variações' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const resumo = vinc.resumo;
    console.log(`catálogo (job) ${familia.ml_item_id} [${vinc.tipo}]: ${JSON.stringify(resumo)}`);

    const tentativaAtual = normalizarTentativaCatalogo(job.tentativa as number);
    const resultado = decidirResultadoRodadaCatalogo(resumo, tentativaAtual);

    if (resultado.acao === 'aguardar_elegibilidade') {
      return new Response(`elegibilidade ainda não computada (${resumo.pendente} pendentes)`, { status: 500, headers: corsHeaders });
    }
    if (resultado.acao === 'reagendar') {
      await enfileirarVinculacaoCatalogo(job.familia_id, resultado.delaySegundos, resultado.proximaTentativa, 2);
      console.log(`catálogo (job) ${familia.ml_item_id}: nao_elegivel na tentativa ${tentativaAtual}, reagendado p/ tentativa ${resultado.proximaTentativa} em +${resultado.delaySegundos}s`);
      return new Response(JSON.stringify({ reagendado: true, proximaTentativa: resultado.proximaTentativa }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Alerta proativo (ADR-0036): sobrou item/variação sem ficha de catálogo equivalente (ficha de
    // kit etc.). A ação "Não encontro minha variação" só existe na UI do ML (sem endpoint OAuth),
    // então avisa o operador p/ resolver à mão ANTES de o ML pausar. Best-effort: falha de Telegram
    // não derruba o opt-in. Espelho variacoes_externas é Legacy-only: no UP o estado de catálogo já
    // vive granularmente em anuncios_externos_itens.catalog_* (não há um único ml_item_id/variação
    // para mapear); espelhar N itens num só ml_item_id fabricaria estrutura — pulado de propósito.
    let cores: string[] = [];
    if (vinc.tipo === 'legacy') {
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
      cores = [...new Set((varsEspelho ?? [])
        .filter((v) => v.catalog_status === 'ficha_divergente' || v.catalog_status === 'sem_produto' || v.catalog_status === 'nao_elegivel')
        .map((v) => (v as { cor?: string | null }).cor)
        .filter((c): c is string => !!c))];
    } else {
      cores = await coresNoMatchUP(admin, familia, vinc.filhos);
    }

    if (resultado.deveAlertar) {
      try {
        // ml_item_id = 1º item da partição 0 no UP (representante §5); serve de âncora do alerta.
        await notificarCategoria(admin, familia.org_id, 'moderacao',
          montarMensagemCatalogoNoMatch({
            ml_item_id: familia.ml_item_id,
            titulo: familia.nome_pai ?? null,
            cores,
            motivo: decidirMotivoAlertaCatalogo(resumo),
          }));
      } catch (e) {
        console.error(`alerta catálogo no-match falhou para ${familia.ml_item_id}:`, (e as Error).message);
      }
    }

    return new Response(JSON.stringify({ item: familia.ml_item_id, tipo: vinc.tipo, resumo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    // Erro transitório (token/rede) → 500 p/ retry. O passo é best-effort e idempotente.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`vincular-catalogo falhou para ${familia.ml_item_id}:`, msg);
    return new Response(msg, { status: 500, headers: corsHeaders });
  }
});
