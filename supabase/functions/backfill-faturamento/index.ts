// Backfill do histórico de vendas (ADR-0037). Popula ml_vendas a partir de /orders/search.
// Dois modos (espelha monitorar-moderados):
//  - Usuário logado (botão "Sincronizar"): JWT → escopo só ao próprio usuário.
//  - QStash agendado: assinatura válida → todos os usuários.
// Não busca shipment por pedido (evita N+1); frete fica null no backfill (líquido = total−comissão).
// O sync-venda (webhook) preenche frete/envio quando o pedido muda.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarPedidosPeriodo, carregarCatalogo, upsertVenda } from '../_shared/faturamento/io.ts';
import { buscarPerguntasSeller, buscarTituloItem, upsertPergunta } from '../_shared/faturamento/perguntas-io.ts';
import { buscarClaimsSeller, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';

interface Body { dias?: number; desde?: string; ate?: string }

function janela(body: Body): { desde: string; ate: string } {
  if (body.desde && body.ate) return { desde: body.desde, ate: body.ate };
  const dias = body.dias && body.dias > 0 ? body.dias : 90;
  const ate = new Date();
  const desde = new Date(ate.getTime() - dias * 24 * 60 * 60 * 1000);
  return { desde: desde.toISOString(), ate: ate.toISOString() };
}

async function processarUsuario(admin: ReturnType<typeof adminClient>, userId: string, intervalo: { desde: string; ate: string }): Promise<number> {
  let token: string;
  try { token = await getValidAccessToken(userId); } catch { return 0; }
  let pedidos;
  try { pedidos = await buscarPedidosPeriodo(token, intervalo); } catch (e) {
    console.warn(`backfill: erro lendo pedidos de ${userId}: ${(e as Error).message}`);
    return 0;
  }
  const { idsPubliai, codigoResolver } = await carregarCatalogo(admin, userId);
  let n = 0;
  for (const pedido of pedidos) {
    try {
      await upsertVenda(admin, userId, pedido, { freteVendedor: null, shipment: null, idsPubliai, codigoResolver });
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
        await upsertPergunta(admin, userId, q, itemId ? titulos.get(itemId) ?? null : null);
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
        await upsertDevolucao(admin, userId, claim, ret);
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
  let scopedUserId: string | null = null;
  if (temAssinatura) {
    if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  } else {
    try { scopedUserId = (await requireUser(req)).id; }
    catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  }

  let payload: Body = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { /* vazio */ }
  const intervalo = janela(payload);

  let userIds: string[];
  if (scopedUserId) userIds = [scopedUserId];
  else {
    const { data } = await admin.from('ml_credentials').select('user_id');
    userIds = (data ?? []).map((c) => c.user_id as string);
  }

  let total = 0;
  for (const userId of userIds) total += await processarUsuario(admin, userId, intervalo);

  return new Response(JSON.stringify({ ok: true, sincronizados: total }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
