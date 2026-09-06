// Análise PubliAI — campos 2.9/3.2/3.3/3.4/7.4 via catálogo + pulse_vendedores (ADR-0142/0143).
// POST { itens: ItemVendas[] } → payload do contrato + meta. Só leitura, no banco e no ML.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { anunciosDaAmostra } from '../_shared/analise/amostra-sonar.ts';
import { carregarSeriePulseVendedores } from '../_shared/analise/carregar-serie-vendedores.ts';
import { montarSecoes237 } from '../_shared/analise/relatorio-secoes-237.ts';
import {
  anunciosComCatalogo,
  catalogosDaAmostra,
  resolverVendedoresDosCatalogos,
} from '../_shared/analise/vendedores-do-catalogo.ts';
import type { ItemVendas } from '../_shared/pulse/sonar-vendas.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try {
    context = await requireUserOrg(req, { access: 'read' });
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const { orgId } = context;

  const db = adminClient();
  if (!(await exigirModulo(db, orgId, 'pulse'))) {
    return json({ erro: 'Módulo Pulse não habilitado para esta organização.' }, 403);
  }

  let body: { busca_id?: string; resultado_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ erro: 'JSON inválido' }, 400);
  }

  const { data: payload, error: payloadError } = await db.rpc('platform_sonar_get_payload', {
    p_actor: context.userId, p_org_id: orgId, p_support_request: context.support?.requestId ?? null,
    p_search_id: body.busca_id, p_result_id: body.resultado_id,
  });
  if (payloadError || !payload || !Array.isArray(payload.itens)) return json({ erro: 'Correlação Sonar inválida' }, 403);
  const itens = payload.itens as ItemVendas[];

  // Sem conexão do ML não há ponte para o vendedor: ausência explícita com 200, mesmo padrão da
  // pulse-sonar-visitas — a tela vive e diz o motivo (ADR-0143, critério 6).
  const conexao = await resolverConexao(db, orgId, 'mercado_livre');
  if (!conexao) return json({ conectado: false });
  const token = await getValidAccessTokenConexao(conexao);

  // conta_externa_id é o seller_id da org no ML: a ficha do catálogo traz a nossa própria oferta.
  const proprioSellerId = Number(conexao.contaExternaId);
  const catalogos = catalogosDaAmostra(itens);
  const doCatalogo = await resolverVendedoresDosCatalogos(
    catalogos,
    token,
    Number.isFinite(proprioSellerId) ? proprioSellerId : null,
  );
  const { anuncios, semSellerId } = anunciosDaAmostra(itens, doCatalogo.sellerPorItem);

  // Base de mercado, não org-scoped (ADR-0144): o número é público e a série de um vendedor
  // coletada por outra organização vale igual para esta.
  const serie = await carregarSeriePulseVendedores(db, doCatalogo.sellerIds);

  const secoes237 = montarSecoes237({
    anuncios,
    anunciosNaAmostra: itens.length,
    anunciosComCatalogo: anunciosComCatalogo(itens, doCatalogo.catalogosOk),
    sellerIdsCatalogo: doCatalogo.sellerIds,
    serie,
  });

  const { error: auditError } = await db.rpc('platform_sonar_log_event', {
    p_actor: context.userId, p_org_id: orgId, p_support_request: context.support?.requestId ?? null,
    p_search_id: body.busca_id, p_result_id: body.resultado_id, p_stage: 'analise_secoes237',
    p_outcome: doCatalogo.catalogos_com_falha > 0 ? 'partial' : 'ready', p_reason: null,
  });
  if (auditError) return json({ erro: 'Falha ao registrar complemento Sonar' }, 503);

  return json({
    conectado: true,
    secoes237,
    meta: {
      vendedores_distintos: doCatalogo.sellerIds.length,
      sem_seller_id: semSellerId,
      serie_linhas: serie.length,
      anuncios_na_amostra: itens.length,
      catalogos_consultados: doCatalogo.catalogos_consultados,
      catalogos_com_falha: doCatalogo.catalogos_com_falha,
    },
  });
});
