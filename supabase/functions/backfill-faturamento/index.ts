// Backfill do histórico de vendas (ADR-0037). Popula ml_vendas a partir de /orders/search.
// Dois modos (espelha monitorar-moderados):
//  - Usuário logado (botão "Sincronizar"): JWT → escopo só à própria org (E7).
//  - QStash agendado: assinatura válida → todas as conexões (todas as orgs).
// Não busca shipment por pedido (evita N+1); frete fica null no backfill (líquido = total−comissão).
// O sync-venda (webhook) preenche frete/envio quando o pedido muda.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarPedidosPeriodo, carregarCatalogo, upsertVenda, buscarShipment, buscarFreteVendedor } from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { buscarPerguntasSeller, buscarTituloItem, upsertPergunta } from '../_shared/faturamento/perguntas-io.ts';
import { buscarClaimsSeller, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';

interface Body { dias?: number; desde?: string; ate?: string }

// E7: iteração por conexão (marketplace_connections), não mais por ml_credentials.user_id.
type ConexaoComDono = ConexaoCanal & { criadoPor: string | null };
interface ConexaoRow {
  id: string; org_id: string; canal: string;
  conta_externa_id: string | null; expires_at: string | null; criado_por: string | null;
}
function mapCx(row: ConexaoRow): ConexaoComDono {
  return { ...mapearConexao(row)!, criadoPor: row.criado_por };
}

function janela(body: Body): { desde: string; ate: string } {
  if (body.desde && body.ate) return { desde: body.desde, ate: body.ate };
  const dias = body.dias && body.dias > 0 ? body.dias : 90;
  const ate = new Date();
  const desde = new Date(ate.getTime() - dias * 24 * 60 * 60 * 1000);
  return { desde: desde.toISOString(), ate: ate.toISOString() };
}

async function processarConexao(admin: ReturnType<typeof adminClient>, cx: ConexaoComDono, intervalo: { desde: string; ate: string }): Promise<number> {
  const orgId = cx.orgId;
  const userId = cx.criadoPor; // proxy legado: tabelas/funções ainda por user_id (carregarCatalogo, perguntas, telegram)
  if (!userId) return 0;
  let token: string;
  try { token = await getValidAccessTokenConexao(cx); } catch { return 0; }
  let pedidos;
  try { pedidos = await buscarPedidosPeriodo(token, intervalo); } catch (e) {
    console.warn(`backfill: erro lendo pedidos da org ${orgId}: ${(e as Error).message}`);
    return 0;
  }
  const { idsPubliai, codigoResolver, eanResolver, infoPorGtin } = await carregarCatalogo(admin, userId);
  const [liquidoPorPayment, gtinPorItem] = await Promise.all([
    carregarLiquidoMP(admin, orgId),
    carregarGtinsFallback(token, pedidos, idsPubliai),
  ]);
  let n = 0;
  for (const pedido of pedidos) {
    try {
      const shippingId = pedido.shipping?.id ?? null;
      const [frete, shipment] = await Promise.all([
        buscarFreteVendedor(token, shippingId),
        buscarShipment(token, shippingId),
      ]);
      await upsertVenda(admin, userId, orgId, pedido, {
        freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, liquidoPorPayment,
      });
      n++;
    } catch (e) {
      console.warn(`backfill: erro upsert pedido ${pedido.id}: ${(e as Error).message}`);
    }
  }

  // Perguntas (sem alerta no backfill — só importa o estado atual).
  try {
    const perguntas = await buscarPerguntasSeller(token);
    const titulos = new Map<string, string | null>();
    for (const q of perguntas) {
      try {
        const itemId = q.item_id ?? null;
        if (itemId && !titulos.has(itemId)) titulos.set(itemId, await buscarTituloItem(token, itemId));
        await upsertPergunta(admin, userId, orgId, q, itemId ? titulos.get(itemId) ?? null : null);
      } catch { /* segue */ }
    }
  } catch (e) {
    console.warn(`backfill: erro lendo perguntas de ${userId}: ${(e as Error).message}`);
  }

  // Devoluções/claims (sem alerta no backfill).
  try {
    const claims = await buscarClaimsSeller(token);
    for (const claim of claims) {
      try {
        const ret = await buscarReturn(token, String(claim.id));
        await upsertDevolucao(admin, userId, orgId, claim, ret);
      } catch { /* segue */ }
    }
  } catch (e) {
    console.warn(`backfill: erro lendo claims de ${userId}: ${(e as Error).message}`);
  }

  return n;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  const admin = adminClient();
  const temAssinatura = !!req.headers.get('upstash-signature');
  let scopedOrgId: string | null = null;
  if (temAssinatura) {
    if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  } else {
    try { ({ orgId: scopedOrgId } = await requireUserOrg(req)); }
    catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  }

  let payload: Body = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { /* vazio */ }
  const intervalo = janela(payload);

  let query = admin.from('marketplace_connections').select('id, org_id, canal, conta_externa_id, expires_at, criado_por').eq('canal', 'mercado_livre');
  if (scopedOrgId) query = query.eq('org_id', scopedOrgId);
  const { data: conexoesRaw } = await query;

  let total = 0;
  for (const row of (conexoesRaw ?? []) as ConexaoRow[]) {
    try {
      total += await processarConexao(admin, mapCx(row), intervalo);
    } catch (e) {
      console.error(`backfill-faturamento: falhou para org ${row.org_id}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify({ ok: true, sincronizados: total }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
