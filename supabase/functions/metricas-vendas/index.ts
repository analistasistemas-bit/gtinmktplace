import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { humanizarErroVendasML } from '../_shared/ml/erro-vendas.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { MetricasVendasCanal } from '../_shared/canais/contrato.ts';

interface Body { desde?: string; ate?: string }

// Agrega as vendas do período dos anúncios gerenciados pelo app (spec dashboard-kpis).
// Espelha status-publicados: o escopo são os ml_item_id do usuário; a leitura passa pelo
// conector de canal (multicanal). Sem credencial ML → semCredencialML (não trava a tela).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  // Gate de auth: só membro autenticado da operação (o token ML usado é o da própria org).
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.desde || !body.ate) {
    return new Response('desde e ate obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  // Escopo da organização (E7): mesma fronteira da lista compartilhada (RLS org_id, D-E7.3).
  const { data: familias } = await admin.from('familias')
    .select('id, ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null);
  const ids = [...new Set((familias ?? []).map((f) => f.ml_item_id as string))];

  // Mapa GTIN → ml_item_id da família dona dele: permite atribuir vendas de catálogo do ML ao
  // produto do usuário por EAN, mesmo quando o pedido entra com o MLB do anúncio âncora (ADR-0045).
  const itemPorFamilia = new Map((familias ?? []).map((f) => [f.id as string, f.ml_item_id as string]));
  const mapaGtin: Record<string, string> = {};
  if (itemPorFamilia.size > 0) {
    const { data: variacoes } = await admin.from('variacoes')
      .select('familia_id, gtin')
      .in('familia_id', [...itemPorFamilia.keys()])
      .not('gtin', 'is', null);
    for (const v of variacoes ?? []) {
      const item = itemPorFamilia.get(v.familia_id as string);
      if (item && v.gtin) mapaGtin[String(v.gtin)] = item;
    }
  }

  const vazio: MetricasVendasCanal = { porItem: {}, totais: { faturamento: 0, unidades: 0, pedidos: 0 } };
  if (ids.length === 0) {
    return new Response(JSON.stringify(vazio), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const conn = getConnector('mercado_livre');
  // Token da conexão ML da org (E7), não a do chamador.
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) {
    return new Response(JSON.stringify({ semCredencialML: true, ...vazio }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };
  let metricas: MetricasVendasCanal;
  try {
    metricas = await conn.lerMetricasVendas(ctx, { desde: body.desde, ate: body.ate }, ids, mapaGtin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distingue falta de credencial (token) de falha na leitura de pedidos (ex.: a app não
    // tem a permissão funcional de Pedidos no DevCenter do ML → 403 PolicyAgent). Antes isso
    // era mascarado como "0 vendas"; agora a UI mostra um aviso claro.
    const semCred = /credenci|sem credenci|conexão|get_connection_tokens|oauth\/token|users\/me/i.test(msg);
    const payload = semCred
      ? { semCredencialML: true, ...vazio }
    : { erroVendas: humanizarErroVendasML(msg), ...vazio };
    return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify(metricas), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
