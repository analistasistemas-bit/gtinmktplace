// Reconciliação periódica (ADR-0037) — rede de segurança p/ webhooks perdidos.
// Disparada por QStash Schedule (ex.: 1h). Re-sincroniza a janela recente de pedidos
// (e perguntas/devoluções nas fases seguintes) de todos os usuários com credencial ML.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarPedidosPeriodo, buscarPedidosPeriodoEstrito, buscarPedido, memoCatalogo, upsertVenda, buscarShipment, buscarFreteVendedor, reconciliarLiberacoes } from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarLiquidoMPDoPedido, carregarGtinsFallback, mapaLiberacaoPorOrder } from '../_shared/faturamento/enriquecimento.ts';
import { buscarPerguntasSeller, buscarTituloItem, upsertPergunta, carregarPerguntasLocais } from '../_shared/faturamento/perguntas-io.ts';
import { buscarClaimsSeller, buscarReturn, upsertDevolucao, carregarDevolucoesLocais } from '../_shared/faturamento/devolucoes-io.ts';
import { mapearPergunta } from '../_shared/faturamento/pergunta.ts';
import { tratarPedidoCancelado } from '../_shared/estoque/cancelamento.ts';
import { depsCancelamento } from '../_shared/estoque/cancelamento-deps.ts';
import { perguntaPrecisaUpsert, claimPrecisaProcessar, claimsDeVenda } from '../_shared/faturamento/reconciliar-filtros.ts';
import { chunk } from '../_shared/faturamento/utils.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth, registrarSyncOk } from '../_shared/ml/liveness.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemConexaoBloqueada } from '../_shared/notificacoes/telegram.ts';
import { lerPendencias, registrarPendencias, temPendenciaAtiva } from '../_shared/faturamento/pendencias.ts';
import type { PedidoML } from '../_shared/faturamento/venda.ts';
import { SemAcessoRodada, cicloHoraUtc, executarMensagem, rotear, statusHttp, type MsgOrg } from '../_shared/rodada/rodada.ts';
import { depsRodada, fanoutAtivo, publicarDisparo } from '../_shared/rodada/deps.ts';
import { desfechoPedido, passoReconciliar, resultadoVazio, type DepsReconciliar, type ParamsReconciliar } from './passo.ts';

const FN = 'reconciliar-faturamento';

const JANELA_HORAS = 72; // re-checa os últimos 3 dias (cobre atrasos/falhas de entrega).

// Requisições ao ML em paralelo por lote — mesmo grau já provado seguro em backfill-faturamento.
const PARALELAS = 5;

// Margem sob o limite de 150s da edge function (confirmado em produção: toda execução desde a
// criação do schedule em 2026-06-22 terminava em WORKER_RESOURCE_LIMIT/IDLE_TIMEOUT aos ~150s,
// derrubando perguntas/devoluções — que rodavam por último — em TODA execução, não só picos).
const ORCAMENTO_MS = 120_000;

type ConexaoComDono = ConexaoCanal & { criadoPor: string };
interface Estado { cx: ConexaoComDono; userId: string; orgId: string; token: string }

// Caminho de hoje (sem FANOUT_RECONCILIAR): todas as orgs numa requisição, sob ORCAMENTO_MS.
async function legado(admin: ReturnType<typeof adminClient>): Promise<Response> {
  const inicio = Date.now();
  const restante = () => ORCAMENTO_MS - (Date.now() - inicio);

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
      const claims = claimsDeVenda(await buscarClaimsSeller(token), cx.contaExternaId);
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
            const { row, ignorado } = await upsertDevolucao(admin, userId, orgId, claim, ret, cx.contaExternaId);
            if (ignorado || row.order_id == null) return;
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
  let liberacoesCorrigidas = 0;
  // Dia corrente BRT, mesma convenção de `notificar-liberacao`.
  const hojeBRT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
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
      } else {
        // Realinha a data de liberação das vendas FORA da janela de 72h: o MP antecipa
        // `money_release_date` na confirmação da entrega sem emitir webhook de pedido, então só o
        // mapa do MP (já carregado, 120 dias) enxerga a mudança. Sem isso o Detalhe do líquido
        // conta como "a liberar" dinheiro que já está na conta.
        try {
          const { corrigidas, marcadas } = await reconciliarLiberacoes(
            admin, orgId, mapaLiberacaoPorOrder(liquidoPorPayment), hojeBRT,
          );
          if (corrigidas > 0) {
            console.log(`reconciliar: ${corrigidas} datas de liberação corrigidas (org ${orgId}), ${marcadas} marcadas como já notificadas`);
          }
          liberacoesCorrigidas += corrigidas;
        } catch (err) {
          console.error(`reconciliar: liberações falharam para org ${orgId}:`, err instanceof Error ? err.message : err);
        }
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

  return new Response(JSON.stringify({ ok: true, reconciliados: total, liberacoesCorrigidas, pulou }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── ADR-0173: rodada por org (pendencias → perguntas → claims → vendas → liberacoes) ────────────

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const pagamentosDoPedido = (pedido: PedidoML) => (pedido.payments ?? []).flatMap((p) => (p?.id != null ? [p.id] : []));

function depsReconciliarReal(admin: ReturnType<typeof adminClient>, orgId: string): DepsReconciliar {
  // 1x por mensagem: claims e pedidos de um lote usam o mesmo catálogo.
  const catalogoDe = memoCatalogo(admin);
  return {
    async conexao() {
      // Erro de leitura LANÇA — virar `null` fecharia a rodada como ok e a hora se perderia calada.
      const { data, error } = await admin.from('marketplace_connections')
        .select('id, org_id, canal, conta_externa_id, expires_at, criado_por')
        .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
      if (error) throw new Error(`ler conexão ML da org: ${error.message}`);
      if (!data) return null;
      return { cx: mapearConexao(data)!, userId: (data.criado_por as string | null) ?? null };
    },

    async token(cx) {
      let token: string;
      try {
        token = await getValidAccessTokenConexao(cx);
      } catch (e) {
        // Mesma liveness/notificação do legado; só token morto fecha a rodada (sem_acesso).
        // Transiente relança → 500 → retry do QStash.
        const status = e instanceof MLApiError ? e.status : null;
        const oauthError = e instanceof MLApiError ? e.oauthError : null;
        if (classificarErroML(status, oauthError) === 'permanente-auth') {
          const { jaAlertado } = await registrarFalhaAuth(admin, cx.id, (e as Error).message);
          if (!jaAlertado) {
            await notificarCategoria(admin, orgId, 'integracao', montarMensagemConexaoBloqueada(orgId, (e as Error).message));
          }
          throw new SemAcessoRodada((e as Error).message);
        }
        throw e;
      }
      await registrarSyncOk(admin, cx.id);
      return token;
    },

    // Perguntas e claims NÃO lançam (como no legado): uma falha persistente aqui prenderia a org
    // nesta etapa a cada ciclo, e vendas/liberações — o que é financeiro — nunca rodariam.
    async perguntas(token, userId, org) {
      let n = 0;
      try {
        const perguntas = await buscarPerguntasSeller(token);
        const itemIds = [...new Set(perguntas.map((q) => q.item_id).filter((i): i is string => !!i))];
        const titulos = new Map<string, string | null>();
        for (const lote of chunk(itemIds, PARALELAS)) {
          await Promise.all(lote.map(async (itemId) => {
            try { titulos.set(itemId, await buscarTituloItem(token, itemId)); } catch { /* segue sem título */ }
          }));
        }
        // Só regrava o que mudou — ver reconciliar-filtros.ts.
        const locais = await carregarPerguntasLocais(
          admin, userId, perguntas.map((q) => Number(q.id)).filter((x) => Number.isFinite(x)),
        );
        const pendentes = perguntas.filter((q) => {
          const row = mapearPergunta(q);
          const itemId = q.item_id ?? null;
          return perguntaPrecisaUpsert(row, itemId ? titulos.get(itemId) ?? null : null, locais.get(row.question_id));
        });
        if (pendentes.length < perguntas.length) {
          console.log(`reconciliar: perguntas org ${org} — ${pendentes.length}/${perguntas.length} precisam de upsert`);
        }
        for (const lote of chunk(pendentes, PARALELAS)) {
          await Promise.all(lote.map(async (q) => {
            try {
              const itemId = q.item_id ?? null;
              await upsertPergunta(admin, userId, org, q, itemId ? titulos.get(itemId) ?? null : null, token);
              n++;
            } catch (e) { console.warn(`reconciliar: pergunta ${q?.id} da org ${org} falhou: ${(e as Error).message}`); }
          }));
        }
      } catch (e) {
        console.warn(`reconciliar: perguntas da org ${org} falharam: ${(e as Error).message}`);
      }
      return n;
    },

    async claimsPendentes(token, userId, contaExternaId) {
      try {
        const claims = claimsDeVenda(await buscarClaimsSeller(token), contaExternaId);
        // Filtra ANTES de buscar o return no ML — ver reconciliar-filtros.ts.
        const locaisDev = await carregarDevolucoesLocais(
          admin, userId, claims.map((c) => Number(c.id)).filter((x) => Number.isFinite(x)),
        );
        const agoraMs = Date.now();
        const pendentes = claims.filter((c) => claimPrecisaProcessar(c, locaisDev.get(Number(c.id)), agoraMs));
        if (pendentes.length < claims.length) {
          console.log(`reconciliar: claims org ${orgId} — ${pendentes.length}/${claims.length} precisam de reprocesso`);
        }
        return pendentes;
      } catch (e) {
        console.warn(`reconciliar: claims da org ${orgId} falharam: ${(e as Error).message}`);
        return [];
      }
    },

    async processarClaims(token, cx, userId, org, claims) {
      const { idsPubliai, codigoResolver, eanResolver, infoPorGtin, custoVigenteResolver } = await catalogoDe(userId);
      let n = 0;
      for (const lote of chunk(claims, PARALELAS)) {
        await Promise.all(lote.map(async (claim) => {
          try {
            const ret = await buscarReturn(token, String(claim.id));
            const { row, ignorado } = await upsertDevolucao(admin, userId, org, claim, ret, cx.contaExternaId);
            if (ignorado || row.order_id == null) { n++; return; }
            const pedido = await buscarPedido(token, String(row.order_id));
            const shippingId = pedido.shipping?.id ?? null;
            const [frete, shipment, liquidoPorPayment, gtinPorItem] = await Promise.all([
              buscarFreteVendedor(token, shippingId),
              buscarShipment(token, shippingId),
              carregarLiquidoMPDoPedido(token, Number(cx.contaExternaId), pagamentosDoPedido(pedido)),
              carregarGtinsFallback(token, [pedido], idsPubliai),
            ]);
            const { itens } = await upsertVenda(admin, userId, org, pedido, {
              freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, custoVigenteResolver, contaExternaId: cx.contaExternaId,
              liquidoPorPayment: liquidoPorPayment ?? undefined,
            });
            // ADR-0121: o cancelamento com devolução chega por aqui (pedido fora da janela de 72h).
            await tratarPedidoCancelado(admin, depsCancelamento, {
              orgId: org, userId, canal: 'mercado_livre', orderId: pedido.id, itens,
              statusPedido: pedido.status ?? null,
              shipmentStatus: shipment?.status != null ? String(shipment.status) : null,
              temEnvio: pedido.shipping?.id != null,
            });
            n++;
          } catch (e) {
            console.warn(`reconciliar: claim ${claim?.id} da org ${org} falhou: ${(e as Error).message}`);
          }
        }));
      }
      return n;
    },

    pedidosDaJanela: (token, janela) => buscarPedidosPeriodoEstrito(token, janela),
    pedidoPorId: (token, id) => buscarPedido(token, id),
    pendencias: (depoisDe, limite) => lerPendencias(admin, orgId, depoisDe, limite),
    registrarPendencias: (ok, inicio, falhas, erro) => registrarPendencias(admin, orgId, ok, inicio, falhas, erro),
    pendentesAtivos: () => temPendenciaAtiva(admin, orgId),
    agora: () => new Date().toISOString(),

    async processarPedidos(token, cx, userId, org, pedidos) {
      const { idsPubliai, codigoResolver, eanResolver, infoPorGtin, custoVigenteResolver } = await catalogoDe(userId);
      const gtinPorItem = await carregarGtinsFallback(token, pedidos, idsPubliai);
      const r = resultadoVazio();
      for (const lote of chunk(pedidos, PARALELAS)) {
        await Promise.all(lote.map(async (pedido) => {
          const erro = await desfechoPedido(r, String(pedido.id), async () => {
            const shippingId = pedido.shipping?.id ?? null;
            // MP por pedido (1-2 GETs), não a varredura de 120 dias — essa fica só na etapa liberacoes.
            const [frete, shipment, liquidoPorPayment] = await Promise.all([
              buscarFreteVendedor(token, shippingId),
              buscarShipment(token, shippingId),
              carregarLiquidoMPDoPedido(token, Number(cx.contaExternaId), pagamentosDoPedido(pedido)),
            ]);
            // null = leitura do MP falhou: preservarDadosMP guarda estorno/liberação já gravados, e o
            // pedido NÃO conta como ok (desfechoPedido) — a pendência dele, se houver, fica para o
            // próximo ciclo. A etapa liberacoes só realinha money_release_date, nunca o estorno.
            if (liquidoPorPayment === null) {
              console.warn(`reconciliar: leitura do MP falhou para o pedido ${pedido.id} (org ${org}); estorno/liberação preservados, pendência mantida`);
            }
            const { itens } = await upsertVenda(admin, userId, org, pedido, {
              freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, custoVigenteResolver, contaExternaId: cx.contaExternaId,
              liquidoPorPayment: liquidoPorPayment ?? undefined,
            });
            // ADR-0121 — idempotente dos dois lados: pode rodar a cada varredura.
            await tratarPedidoCancelado(admin, depsCancelamento, {
              orgId: org, userId, canal: 'mercado_livre', orderId: pedido.id, itens,
              statusPedido: pedido.status ?? null,
              shipmentStatus: shipment?.status != null ? String(shipment.status) : null,
              temEnvio: pedido.shipping?.id != null,
            });
            return liquidoPorPayment !== null;
          });
          if (erro) console.warn(`reconciliar: pedido ${pedido.id} da org ${org} falhou: ${(erro as Error)?.message ?? erro}`);
        }));
      }
      return r;
    },

    async liberacoes(token, cx, org, hojeBRT) {
      const liquidoPorPayment = await carregarLiquidoMP(token, Number(cx.contaExternaId));
      if (liquidoPorPayment === null) {
        console.warn(`reconciliar: leitura do MP falhou para a org ${org}; liberações ficam para o próximo ciclo`);
        return 0;
      }
      // Erro de banco aqui LANÇA (→ retry): a etapa roda isolada, não derruba vendas como no legado.
      const { corrigidas, marcadas } = await reconciliarLiberacoes(admin, org, mapaLiberacaoPorOrder(liquidoPorPayment), hojeBRT);
      if (corrigidas > 0) {
        console.log(`reconciliar: ${corrigidas} datas de liberação corrigidas (org ${org}), ${marcadas} marcadas como já notificadas`);
      }
      return corrigidas;
    },
  };
}

async function consumirMensagemOrg(admin: ReturnType<typeof adminClient>, msg: MsgOrg): Promise<Response> {
  const p = msg.params as Partial<ParamsReconciliar>;
  // Mensagem de outro job (ou sem janela) nunca roda o passo do reconciliar sobre a rodada alheia.
  if (msg.job !== 'reconciliar' || typeof p.desde !== 'string' || typeof p.ate !== 'string' || typeof p.hojeBRT !== 'string') {
    console.error(`reconciliar: mensagem por org de job/params inválidos, descartada: job=${msg.job} org=${msg.org_id}`);
    return json({ ok: false, erro: 'job ou params inválidos para o reconciliar' }, 400);
  }
  const m = msg as MsgOrg<ParamsReconciliar>;
  try {
    const r = await executarMensagem(depsRodada(admin, FN), m, passoReconciliar(depsReconciliarReal(admin, m.org_id), m.org_id));
    return json({ resultado: r }, statusHttp(r));
  } catch (e) {
    // abrir/avancar/liberar lançaram (RPC fora): 500 → retry do QStash.
    console.error(`reconciliar: mensagem por org falhou (org=${m.org_id} ciclo=${m.ciclo}):`, e instanceof Error ? e.message : e);
    return json({ ok: false, erro: 'falha interna' }, 500);
  }
}

async function disparar(admin: ReturnType<typeof adminClient>): Promise<Response> {
  const agora = new Date();
  const params: ParamsReconciliar = {
    desde: new Date(agora.getTime() - JANELA_HORAS * 60 * 60 * 1000).toISOString(),
    ate: agora.toISOString(),
    // Dia corrente BRT (convenção de `notificar-liberacao`), gravado na abertura, nunca recalculado.
    hojeBRT: agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
  };
  const ciclo = cicloHoraUtc(agora);
  // Como o legado: conexão sem dono (criado_por null) não entra.
  const { data, error } = await admin.from('marketplace_connections').select('org_id')
    .eq('canal', 'mercado_livre').not('criado_por', 'is', null);
  if (error) {
    console.error(`reconciliar: disparo não leu as conexões: ${error.message}`);
    return json({ ok: false, erro: 'falha ao ler conexões' }, 500);
  }
  const orgs = [...new Set(((data ?? []) as Array<{ org_id: string }>).map((r) => r.org_id))];
  try {
    await publicarDisparo(FN, orgs.map((org_id) => ({ modo: 'org' as const, job: 'reconciliar' as const, org_id, ciclo, params })));
  } catch (e) {
    console.error(`reconciliar: disparo ciclo=${ciclo} falhou ao publicar:`, e instanceof Error ? e.message : e);
    return json({ ok: false, erro: 'falha ao publicar o disparo' }, 500);
  }
  console.log(`reconciliar: disparo ciclo=${ciclo} janela=${params.desde}..${params.ate} orgs=${orgs.length}`);
  return json({ ok: true, job: 'reconciliar', ciclo, orgs: orgs.length });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  // Sem caminho manual: sem assinatura QStash válida segue 401, como sempre.
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  const admin = adminClient();

  let parsed: unknown = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { /* corpo não-JSON: é o schedule, segue */ }

  // Mensagem por org sempre aceita; disparador em fan-out só com FANOUT_RECONCILIAR.
  const rota = rotear(true, parsed, fanoutAtivo('FANOUT_RECONCILIAR'));
  if (rota === 'invalida') {
    console.error(`reconciliar: mensagem modo:'org' malformada, descartada: ${body.slice(0, 500)}`);
    return json({ ok: false, erro: 'mensagem por org malformada' }, 400);
  }
  if (rota === 'org') return await consumirMensagemOrg(admin, parsed as MsgOrg);
  if (rota === 'disparo') return await disparar(admin);
  return await legado(admin);
});
