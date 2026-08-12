// Worker de sincronização de venda (ADR-0037). Consome QStash (assinatura válida).
// Job: { user_id, order_id } (orders_v2) ou { user_id, shipping_id } (shipments).
// Faz fetch autenticado do pedido (+ shipment/frete), upsert e alerta Telegram em venda nova.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import {
  registrarBaixaVenda, estornarVendaCancelada, despacharPushPendente,
} from '../_shared/estoque/baixa.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import {
  buscarPedido, buscarFreteVendedor, buscarShipment, carregarCatalogo, upsertVenda, resolverOrgPorUserId,
} from '../_shared/faturamento/io.ts';
import { ehVendaDaConta } from '../_shared/faturamento/venda.ts';
import { reservarNotificacao } from '../_shared/faturamento/notificacoes-dedupe.ts';
import { carregarLiquidoMPDoPedido, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemNovaVenda, montarMensagemConexaoBloqueada } from '../_shared/notificacoes/telegram.ts';
import { enviarMensagemPedido } from '../_shared/ml/mensagem.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth, registrarSyncOk } from '../_shared/ml/liveness.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

interface Job { user_id?: string; order_id?: string; shipping_id?: string }

/** Classifica o erro (token ou fetch do recurso) e trata conforme a liveness (ADR-0069):
 * permanente-auth → registra + alerta (só na 1ª falha) e responde 200 (não re-tenta sozinho,
 * a conexão está morta); transiente → responde 502 pro QStash re-tentar. */
async function tratarFalha(
  admin: SupabaseClient, conexao: ConexaoCanal, orgId: string | null, e: unknown,
): Promise<Response> {
  const status = e instanceof MLApiError ? e.status : null;
  const oauthError = e instanceof MLApiError ? e.oauthError : null;
  const classe = classificarErroML(status, oauthError);
  if (classe === 'permanente-auth') {
    const { jaAlertado } = await registrarFalhaAuth(admin, conexao.id, (e as Error).message);
    if (!jaAlertado && orgId) {
      await notificarCategoria(admin, orgId, 'integracao', montarMensagemConexaoBloqueada(orgId, (e as Error).message));
    }
    return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: false, transiente: true }), { status: 502, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  let job: Job;
  try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const userId = job.user_id;
  if (!userId) return new Response('user_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const orgId = await resolverOrgPorUserId(admin, userId);
  const conexao = orgId ? await resolverConexao(admin, orgId, 'mercado_livre') : null;
  if (!conexao) return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders });

  let token: string;
  try {
    token = await getValidAccessTokenConexao(conexao);
  } catch (e) {
    return await tratarFalha(admin, conexao, orgId, e);
  }

  // Resolve order_id: direto, ou via shipping_id (busca a venda já registrada com esse envio).
  let orderId = job.order_id ?? null;
  if (!orderId && job.shipping_id) {
    const { data } = await admin.from('ml_vendas')
      .select('order_id').eq('user_id', userId).eq('shipping_id', Number(job.shipping_id)).maybeSingle();
    orderId = data?.order_id != null ? String(data.order_id) : null;
  }
  if (!orderId) return new Response(JSON.stringify({ ok: true, ignorado: true }), { status: 200, headers: corsHeaders });

  let pedido;
  try {
    pedido = await buscarPedido(token, orderId);
  } catch (e) {
    if (e instanceof MLApiError && classificarErroML(e.status) === 'nao-encontrado') {
      return new Response(JSON.stringify({ ok: false, naoEncontrado: true }), { status: 200, headers: corsHeaders });
    }
    return await tratarFalha(admin, conexao, orgId, e);
  }

  // O webhook `orders_v2` também notifica pedidos em que a conta é COMPRADORA. Sem esta guarda,
  // cada compra da empresa entrava em ml_vendas como venda e inflava o faturamento (23 linhas,
  // R$ 8.810,50 em `paid`, medido em 2026-08-12). 200 e não erro: ignorar é o resultado correto,
  // não uma falha — 4xx/5xx faria o QStash re-tentar para sempre.
  if (!ehVendaDaConta(pedido, conexao.contaExternaId)) {
    return new Response(
      JSON.stringify({ ok: true, ignorado: 'compra-da-conta', order_id: String(pedido.id) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const { idsPubliai, codigoResolver, eanResolver, infoPorGtin, custoVigenteResolver } = await carregarCatalogo(admin, userId);
  const shippingId = pedido.shipping?.id ?? null;
  const [frete, shipment, liquidoPorPayment, gtinPorItem] = await Promise.all([
    buscarFreteVendedor(token, shippingId),
    buscarShipment(token, shippingId),
    // Só os pagamentos deste pedido (1-2 requisições), não a varredura de 120 dias do MP.
    carregarLiquidoMPDoPedido(token, Number(conexao.contaExternaId),
      (pedido.payments ?? []).flatMap((p) => (p?.id != null ? [p.id] : []))),
    carregarGtinsFallback(token, [pedido], idsPubliai),
  ]);

  const { novaPaga, itens, compradorNome } = await upsertVenda(admin, userId, orgId, pedido, {
    freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, custoVigenteResolver,
    liquidoPorPayment: liquidoPorPayment ?? undefined,
  });

  // Alerta de nova venda paga aos destinatários da categoria 'vendas'. Usa os itens já com EAN
  // resolvido (catálogo/GTIN) e o nome real do comprador já resolvido pelo upsert (nunca o
  // nickname). notificarCategoria respeita o interruptor-mestre da org.
  // reservarNotificacao garante 1 notificação por venda paga mesmo se novaPaga vier true em
  // execuções concorrentes do mesmo pedido (retry QStash) — só quem ganha o INSERT notifica.
  if (novaPaga && orgId && await reservarNotificacao(admin, orgId, userId, 'venda_paga', String(pedido.id))) {
    await notificarCategoria(admin, orgId, 'vendas', montarMensagemNovaVenda({
      order_id: Number(pedido.id),
      pack_id: pedido.pack_id != null ? Number(pedido.pack_id) : null,
      comprador: compradorNome,
      itens: itens.map((i) => ({ titulo: i.titulo, quantity: i.quantity, ean: i.ean })),
      total: Number(pedido.total_amount ?? 0),
      moeda: pedido.currency_id ?? 'BRL',
    }));

    // Mensagem automática ao comprador via ML (best-effort). O POST do ML exige o `to.user_id`.
    if (conexao?.contaExternaId && pedido.buyer?.id != null) {
      const packId = pedido.pack_id ?? pedido.id;
      await enviarMensagemPedido(
        token,
        packId,
        conexao.contaExternaId,
        String(pedido.buyer.id),
        'Olá! Recebemos seu pedido e já estamos separando. Em caso de dúvida, fique à vontade para chamar aqui pelo chat. Obrigado pela compra! 🙏',
      );
    }
  }

  // E6b (ADR-0094): baixa de estoque. A venda é SAGRADA — nenhuma falha aqui pode
  // derrubar o sync.
  //
  // ATENÇÃO — a condição é `pedido pago`, NÃO `novaPaga`. `novaPaga` é one-shot
  // (calculado do status já persistido, io.ts:270): se a baixa falhasse no meio, o
  // retry veria novaPaga=false e a perda seria permanente. Gatear em "está pago" faz
  // o retry retomar naturalmente, e a idempotência vem do ledger: cada SKU já baixado
  // devolve `aplicado=false` e não é reaplicado.
  if (pedido.status === 'paid' && orgId) {
    try {
      const { pendentesDePush, semSaldo, falhas, semSku } = await registrarBaixaVenda(admin, {
        orgId, canal: 'mercado_livre', orderId: pedido.id, itens,
      });
      // Despacha o OUTBOX, não só o que esta execução aplicou: assim um push que ficou
      // para trás numa execução anterior é reenviado aqui. O canal de origem NÃO é
      // passado — cada movimento carrega a própria intenção.
      await despacharPushPendente(admin, orgId, pendentesDePush, enfileirarSincronizacaoEstoque);

      // Todo alerta passa por reservarNotificacao: o sync-venda roda várias vezes para
      // o mesmo pedido (webhooks de order + de shipment).
      if (semSaldo.length > 0
        && await reservarNotificacao(admin, orgId, userId, 'estoque_sem_saldo', String(pedido.id))) {
        const linhas = semSaldo.map((s) => `• ${s.codigo} — pedido de ${s.pedido} un.`).join('\n');
        await notificarCategoria(
          admin, orgId, 'vendas',
          `⚠️ Venda sem saldo suficiente (pedido ${pedido.id})\n\n${linhas}\n\n`
          + 'O estoque foi zerado e o anúncio pode ter vendido mais do que você tem.',
        );
      }
      // Venda paga que não achou SKU: o saldo NÃO desceu e antes isso não deixava rastro
      // nenhum (incidente de 2026-08-11, 12 unidades). Agora vira movimento informativo no
      // ledger + alerta, porque só o operador sabe qual produto é.
      if (semSku.length > 0
        && await reservarNotificacao(admin, orgId, userId, 'estoque_venda_sem_sku', String(pedido.id))) {
        const linhas = semSku
          .map((s) => `• ${s.titulo ?? s.mlItemId ?? 'item sem título'} — ${s.quantidade} un.`)
          .join('\n');
        await notificarCategoria(
          admin, orgId, 'vendas',
          `⚠️ Venda sem SKU reconhecido (pedido ${pedido.id})\n\n${linhas}\n\n`
          + 'O estoque NÃO foi baixado desses itens porque o anúncio não está vinculado a um '
          + 'produto do PubliAI. Confira o saldo em Estoque → Ajustar.',
        );
      }
      // Falha de RPC é irrecuperável sozinha: o operador PRECISA saber para ajustar.
      if (falhas.length > 0
        && await reservarNotificacao(admin, orgId, userId, 'estoque_baixa_falhou', String(pedido.id))) {
        const linhas = falhas.map((f) => `• ${f.codigo}: ${f.mensagem}`).join('\n');
        await notificarCategoria(
          admin, orgId, 'vendas',
          `🚨 Falha ao baixar estoque do pedido ${pedido.id}\n\n${linhas}\n\n`
          + 'O saldo NÃO foi decrementado desses SKUs. Ajuste manualmente na tela de Estoque.',
        );
      }
    } catch (e) {
      console.error('baixa_estoque_falhou', e);
    }
  }

  // Cancelado ANTES do despacho: a mercadoria nunca saiu, então repõe (D-7).
  //
  // FALHA FECHADA: `buscarShipment` devolve null em QUALQUER erro HTTP ou de rede
  // (io.ts:139-163), inclusive para pedido já despachado. Tratar null como "não
  // despachado" reporia estoque de mercadoria que saiu. Só repõe quando o status é
  // explicitamente um estado pré-despacho conhecido (ou o pedido não tem envio).
  if (orgId && pedido.status === 'cancelled') {
    const PRE_DESPACHO = ['pending', 'handling', 'ready_to_ship'];
    const st = shipment?.status != null ? String(shipment.status) : null;
    const preDespachoConhecido = st !== null && PRE_DESPACHO.includes(st);
    const semEnvio = pedido.shipping?.id == null;
    try {
      if (preDespachoConhecido || semEnvio) {
        // A checagem "houve baixa?" vive dentro da RPC, atômica com o estorno — e
        // quando não há baixa ela grava o tombstone que impede a execução `paid`
        // posterior de baixar um pedido já cancelado.
        const { pendentesDePush } = await estornarVendaCancelada(admin, {
          orgId, canal: 'mercado_livre', orderId: pedido.id, itens,
        });
        // Os movimentos de estorno nascem com push_canal_origem = null, então a
        // reposição alcança TODOS os canais — inclusive o ML, que não repõe sozinho.
        await despacharPushPendente(admin, orgId, pendentesDePush, enfileirarSincronizacaoEstoque);
      } else if (await reservarNotificacao(admin, orgId, userId, 'estoque_cancelado_despachado', String(pedido.id))) {
        await notificarCategoria(
          admin, orgId, 'pos_venda',
          `📦 Pedido ${pedido.id} cancelado, mas o envio ${st === null ? 'não pôde ser consultado' : `está em "${st}"`}.\n\n`
          + 'O estoque NÃO foi reposto automaticamente — confira o que voltou e dê entrada manual.',
        );
      }
    } catch (e) {
      console.error('estorno_estoque_falhou', e);
    }
  }

  // Leitura do MP falhou: a venda e o alerta já saíram (upsertVenda é idempotente e
  // preservarDadosMP manteve estorno/liberação anteriores), mas estorno/liberação podem estar
  // defasados. 502 para o QStash re-tentar; o retry não duplica alerta porque novaPaga é
  // recomputado do status já gravado. Não marca processado_em nem registrarSyncOk.
  if (liquidoPorPayment === null) {
    return new Response(JSON.stringify({ ok: false, mpIndisponivel: true }), { status: 502, headers: corsHeaders });
  }

  // Marca o evento processado (best-effort).
  await admin.from('ml_webhook_eventos').update({ processado_em: new Date().toISOString() })
    .eq('topic', 'orders_v2').eq('resource', `/orders/${orderId}`);

  // Sucesso: registra liveness (reseta alerta de auth se a conexão tinha caído antes).
  await registrarSyncOk(admin, conexao.id);

  return new Response(JSON.stringify({ ok: true, novaPaga }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
