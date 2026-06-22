// Reconciliação periódica (ADR-0037) — rede de segurança p/ webhooks perdidos.
// Disparada por QStash Schedule (ex.: 1h). Re-sincroniza a janela recente de pedidos
// (e perguntas/devoluções nas fases seguintes) de todos os usuários com credencial ML.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarPedidosPeriodo, carregarCatalogo, upsertVenda } from '../_shared/faturamento/io.ts';

const JANELA_HORAS = 72; // re-checa os últimos 3 dias (cobre atrasos/falhas de entrega).

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  const ate = new Date();
  const desde = new Date(ate.getTime() - JANELA_HORAS * 60 * 60 * 1000);
  const intervalo = { desde: desde.toISOString(), ate: ate.toISOString() };

  const { data: contas } = await admin.from('ml_credentials').select('user_id');
  let total = 0;
  for (const c of contas ?? []) {
    const userId = c.user_id as string;
    let token: string;
    try { token = await getValidAccessToken(userId); } catch { continue; }
    let pedidos;
    try { pedidos = await buscarPedidosPeriodo(token, intervalo); } catch { continue; }
    const { idsPubliai, codigoResolver } = await carregarCatalogo(admin, userId);
    for (const pedido of pedidos) {
      try {
        await upsertVenda(admin, userId, pedido, { freteVendedor: null, shipment: null, idsPubliai, codigoResolver });
        total++;
      } catch { /* segue */ }
    }
  }

  return new Response(JSON.stringify({ ok: true, reconciliados: total }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
