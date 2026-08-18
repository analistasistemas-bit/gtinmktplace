// Reconciliação periódica (ADR-0037) — rede de segurança p/ webhooks perdidos.
// Disparada por QStash Schedule (ex.: 1h). Re-sincroniza a janela recente de pedidos
// (e perguntas/devoluções nas fases seguintes) de todos os usuários com credencial ML.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarPedidosPeriodo, buscarPedido, memoCatalogo, upsertVenda, buscarShipment, buscarFreteVendedor } from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarLiquidoMPDoPedido, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { buscarPerguntasSeller, buscarTituloItem, upsertPergunta, carregarPerguntasLocais } from '../_shared/faturamento/perguntas-io.ts';
import { buscarClaimsSeller, buscarReturn, upsertDevolucao, carregarDevolucoesLocais } from '../_shared/faturamento/devolucoes-io.ts';
import { mapearPergunta } from '../_shared/faturamento/pergunta.ts';
import { tratarPedidoCancelado } from '../_shared/estoque/cancelamento.ts';
import { depsCancelamento } from '../_shared/estoque/cancelamento-deps.ts';
import { perguntaPrecisaUpsert, claimPrecisaProcessar } from '../_shared/faturamento/reconciliar-filtros.ts';
import { chunk } from '../_shared/faturamento/utils.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth, registrarSyncOk } from '../_shared/ml/liveness.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemConexaoBloqueada } from '../_shared/notificacoes/telegram.ts';

const JANELA_HORAS = 72; // re-checa os últimos 3 dias (cobre atrasos/falhas de entrega).

// Requisições ao ML em paralelo por lote — mesmo grau já provado seguro em backfill-faturamento.
const PARALELAS = 5;

// Margem sob o limite de 150s da edge function (confirmado em produção: toda execução desde a
// criação do schedule em 2026-06-22 terminava em WORKER_RESOURCE_LIMIT/IDLE_TIMEOUT aos ~150s,
// derrubando perguntas/devoluções — que rodavam por último — em TODA execução, não só picos).
const ORCAMENTO_MS = 120_000;

type ConexaoComDono = ConexaoCanal & { criadoPor: string };
interface Estado { cx: ConexaoComDono; userId: string; orgId: string; token: string }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const inicio = Date.now();
  const restante = () => ORCAMENTO_MS - (Date.now() - inicio);

  const admin = adminClient();
  // Memo por invocação: claims (passo 1) e vendas (passo 2) usam o MESMO catálogo por org.
  const catalogoDe = memoCatalogo(admin);
  const ate = new Date();
  const desde = new Date(ate.getTime() - JANELA_HORAS * 60 * 60 * 1000);
  const intervalo = { desde: desde.toISOString(), ate: ate.toISOString() };

  // E7: itera as conexões (marketplace_connections), não mais ml_credentials.user_id.
  const { data: conexoesRaw } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por').eq('canal', 'mercado_livre');

  // Resolve token uma vez por conexão (liveness já registrada aqui — não depende do resto da
  // execução, mesma semântica de antes: só o catch do token classifica erro de auth).
  const estados: Estado[] = [];
  for (const c of conexoesRaw ?? []) {
    const orgId = c.org_id as string;
    const userId = (c.criado_por as string | null) ?? null; // proxy legado por user_id
    if (!userId) continue;
    const cx = { ...mapearConexao(c)!, criadoPor: userId };
    try {
      const token = await getValidAccessTokenConexao(cx);
      await registrarSyncOk(admin, cx.id);
      estados.push({ cx, userId, orgId, token });
    } catch (e) {
      const status = e instanceof MLApiError ? e.status : null;
      const oauthError = e instanceof MLApiError ? e.oauthError : null;
      if (classificarErroML(status, oauthError) === 'permanente-auth') {
        const { jaAlertado } = await registrarFalhaAuth(admin, cx.id, (e as Error).message);
        if (!jaAlertado) {
          await notificarCategoria(admin, orgId, 'integracao', montarMensagemConexaoBloqueada(orgId, (e as Error).message));
        }
      }
    }
  }

  const pulou: string[] = [];

  // Passo 1 (TODAS as orgs primeiro): perguntas + devoluções/claims + resync do estorno via MP
  // dos pedidos associados a devoluções fora da janela de 72h. Roda antes de Vendas para nunca
  // ficar de fora se o orçamento estourar — mesmo achado que já corrigiu 504/546 em
  // backfill-faturamento (reordenar o item mais barato pra frente do mais caro).
  for (const e of estados) {
    if (restante() < 15_000) { pulou.push(`${e.orgId}:perguntas+devolucoes`); continue; }
    const { cx, userId, orgId, token } = e;

    try {
      const perguntas = await buscarPerguntasSeller(token);
      const itemIds = [...new Set(perguntas.map((q) => q.item_id).filter((i): i is string => !!i))];
      const titulos = new Map<string, string | null>();
      for (const lote of chunk(itemIds, PARALELAS)) {
        await Promise.all(lote.map(async (itemId) => {
          try { titulos.set(itemId, await buscarTituloItem(token, itemId)); } catch { /* segue sem título */ }
        }));
      }
      // Só regrava o que mudou. Pergunta respondida no ML é imutável, e a varredura horária
      // reescrevia todas elas (2 requisições cada) para nada — ver reconciliar-filtros.ts.
      const locais = await carregarPerguntasLocais(
        admin, userId, perguntas.map((q) => Number(q.id)).filter((n) => Number.isFinite(n)),
      );
      const pendentes = perguntas.filter((q) => {
        const row = mapearPergunta(q);
        const itemId = q.item_id ?? null;
        return perguntaPrecisaUpsert(row, itemId ? titulos.get(itemId) ?? null : null, locais.get(row.question_id));
      });
      if (pendentes.length < perguntas.length) {
        console.log(`reconciliar: perguntas org ${orgId} — ${pendentes.length}/${perguntas.length} precisam de upsert`);
      }
      for (const lote of chunk(pendentes, PARALELAS)) {
        await Promise.all(lote.map(async (q) => {
          try {
            const itemId = q.item_id ?? null;
            await upsertPergunta(admin, userId, orgId, q, itemId ? titulos.get(itemId) ?? null : null, token);
          } catch { /* segue */ }
        }));
      }
    } catch { /* segue */ }

    try {
      const claims = await buscarClaimsSeller(token);
      // Reprocessar um claim custa ~8 requisições REST (return + devolução + pedido + venda
      // inteira). Claim fechado há semanas, com dinheiro resolvido e mesmo status/stage, não tem
      // o que atualizar — ver reconciliar-filtros.ts. Filtra ANTES de buscar o return no ML.
      const locaisDev = await carregarDevolucoesLocais(
        admin, userId, claims.map((c) => Number(c.id)).filter((n) => Number.isFinite(n)),
      );
      const agoraMs = Date.now();
      const claimsPendentes = claims.filter((c) => claimPrecisaProcessar(c, locaisDev.get(Number(c.id)), agoraMs));
      if (claimsPendentes.length < claims.length) {
        console.log(`reconciliar: claims org ${orgId} — ${claimsPendentes.length}/${claims.length} precisam de reprocesso`);
      }
      const { idsPubliai, codigoResolver, eanResolver, infoPorGtin, custoVigenteResolver } = await catalogoDe(userId);
      for (const lote of chunk(claimsPendentes, PARALELAS)) {
        await Promise.all(lote.map(async (claim) => {
          try {
            const ret = await buscarReturn(token, String(claim.id));
            const { row } = await upsertDevolucao(admin, userId, orgId, claim, ret, cx.contaExternaId);
            if (row.order_id == null) return;
            const pedido = await buscarPedido(token, String(row.order_id));
            const shippingId = pedido.shipping?.id ?? null;
            const [frete, shipment, liquidoPorPayment, gtinPorItem] = await Promise.all([
              buscarFreteVendedor(token, shippingId),
              buscarShipment(token, shippingId),
              carregarLiquidoMPDoPedido(token, Number(cx.contaExternaId),
                (pedido.payments ?? []).flatMap((p) => (p?.id != null ? [p.id] : []))),
              carregarGtinsFallback(token, [pedido], idsPubliai),
            ]);
            const { itens } = await upsertVenda(admin, userId, orgId, pedido, {
              freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, custoVigenteResolver, contaExternaId: cx.contaExternaId,
              liquidoPorPayment: liquidoPorPayment ?? undefined,
            });
            // ADR-0121: é por AQUI que o cancelamento com devolução chega — o pedido já saiu da
            // janela de 72h do passo 2, e o webhook do cancelamento pode nunca ter vindo.
            await tratarPedidoCancelado(admin, depsCancelamento, {
              orgId, userId, canal: 'mercado_livre', orderId: pedido.id, itens,
              statusPedido: pedido.status ?? null,
              shipmentStatus: shipment?.status != null ? String(shipment.status) : null,
              temEnvio: pedido.shipping?.id != null,
            });
          } catch { /* segue */ }
        }));
      }
    } catch { /* segue */ }
  }

  // Passo 2 (TODAS as orgs): Vendas (72h) — o item mais caro, agora por último.
  let total = 0;
  for (const e of estados) {
    if (restante() < 10_000) { pulou.push(`${e.orgId}:vendas`); continue; }
    const { userId, orgId, token } = e;
    try {
      const pedidos = await buscarPedidosPeriodo(token, intervalo);
      const { idsPubliai, codigoResolver, eanResolver, infoPorGtin, custoVigenteResolver } = await catalogoDe(userId);
      const [liquidoPorPayment, gtinPorItem] = await Promise.all([
        carregarLiquidoMP(token, Number(e.cx.contaExternaId)),
        carregarGtinsFallback(token, pedidos, idsPubliai),
      ]);
      // Varredura periódica: loga e segue. preservarDadosMP impede que o mapa vazio apague
      // estorno/liberação já gravados, e a próxima rodada volta a estes pedidos.
      if (liquidoPorPayment === null) {
        console.warn(`reconciliar: leitura do MP falhou para a org ${orgId}; estorno/liberação preservados`);
      }
      for (const lote of chunk(pedidos, PARALELAS)) {
        await Promise.all(lote.map(async (pedido) => {
          try {
            const shippingId = pedido.shipping?.id ?? null;
            const [frete, shipment] = await Promise.all([
              buscarFreteVendedor(token, shippingId),
              buscarShipment(token, shippingId),
            ]);
            const { itens } = await upsertVenda(admin, userId, orgId, pedido, {
              freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, custoVigenteResolver, contaExternaId: e.cx.contaExternaId,
              liquidoPorPayment: liquidoPorPayment ?? undefined,
            });
            // ADR-0121 — o sync-venda só vê o cancelamento se o ML reenviar o webhook, e ele nem
            // sempre reenvia. Idempotente dos dois lados: pode rodar a cada varredura.
            await tratarPedidoCancelado(admin, depsCancelamento, {
              orgId, userId, canal: 'mercado_livre', orderId: pedido.id, itens,
              statusPedido: pedido.status ?? null,
              shipmentStatus: shipment?.status != null ? String(shipment.status) : null,
              temEnvio: pedido.shipping?.id != null,
            });
            total++;
          } catch { /* segue */ }
        }));
      }
    } catch (err) {
      console.error(`reconciliar-faturamento: vendas falhou para org ${orgId}:`, err instanceof Error ? err.message : err);
    }
  }

  if (pulou.length > 0) console.warn(`reconciliar-faturamento: orçamento de tempo esgotado, pulou: ${pulou.join(', ')}`);

  return new Response(JSON.stringify({ ok: true, reconciliados: total, pulou }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
