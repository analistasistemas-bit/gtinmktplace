// Backfill do histórico de vendas (ADR-0037). Popula ml_vendas a partir de /orders/search.
// Dois modos (espelha monitorar-moderados):
//  - Usuário logado (botão "Sincronizar"): JWT → escopo só à própria org (E7).
//  - QStash agendado: assinatura válida → todas as conexões (todas as orgs).
// Busca frete/envio por pedido (1 GET de shipment + 1 de custo por pedido, desde 9675f3a). É o
// item mais caro da execução e cresce com o volume — ver PARALELAS e o teto medido abaixo.
//
// TETO MEDIDO (2026-07-27, conta Avil ~600 pedidos/30d, limite da edge function ~150s):
//   dias=7 → 66s · dias=30 → 129s · custo fixo ≈47s + ~2,7s por dia de janela.
// Logo `dias=90` (~294s) NÃO cabe numa execução e nunca coube. Ao mexer aqui, meça de novo:
// quando 30 dias passar de ~140s, ou se reduz a janela do schedule (o reconciliar-faturamento
// já cobre 72h de hora em hora) ou o backfill precisa virar retomável entre execuções.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarPedidosPeriodo, carregarCatalogo, upsertVenda, buscarShipment, buscarFreteVendedor } from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { buscarPerguntasSeller, buscarTituloItem, upsertPergunta } from '../_shared/faturamento/perguntas-io.ts';
import { buscarMensagensPack, upsertMensagens, listarPacksDeVendas } from '../_shared/faturamento/mensagens-io.ts';
import { buscarClaimsSeller, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';
import { chunk } from '../_shared/faturamento/utils.ts';

interface Body { dias?: number; desde?: string; ate?: string }

// Requisições ao ML em paralelo por lote. Era 5 só no laço de pedidos; perguntas, claims e
// mensagens rodavam uma a uma e estouravam o tempo da edge function (504 de hora em hora,
// 28 falhas em 2026-07-26). Medido: com `dias:1` — ou seja, quase só o custo fixo — a execução
// levava 117s de um orçamento de ~150s, e o pior ofensor era 1 GET por pack de mensagens,
// sequencial, até 200 packs. Mesmo grau de paralelismo já provado seguro no laço de pedidos.
const PARALELAS = 5;

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

  // 1. Perguntas (sem alerta no backfill — só importa o estado atual).
  //    Títulos primeiro, deduplicados por item: várias perguntas caem no mesmo anúncio.
  try {
    const perguntas = await buscarPerguntasSeller(token);
    const itemIds = [...new Set(perguntas.map((q) => q.item_id).filter((i): i is string => !!i))];
    const titulos = new Map<string, string | null>();
    const tituloFalhou = new Set<string>();
    for (const lote of chunk(itemIds, PARALELAS)) {
      await Promise.all(lote.map(async (itemId) => {
        try { titulos.set(itemId, await buscarTituloItem(token, itemId)); } catch { tituloFalhou.add(itemId); }
      }));
    }
    for (const lote of chunk(perguntas, PARALELAS)) {
      await Promise.all(lote.map(async (q) => {
        try {
          const itemId = q.item_id ?? null;
          // `upsertPergunta` grava item_titulo incondicionalmente: passar null quando a busca do
          // título FALHOU apagaria o título já salvo. Antes da paralelização o catch pulava o
          // upsert inteiro nesse caso; preserva-se o mesmo efeito. Título que veio null de verdade
          // (item sem título) segue sendo gravado.
          if (itemId && tituloFalhou.has(itemId)) return;
          await upsertPergunta(admin, userId, orgId, q, itemId ? titulos.get(itemId) ?? null : null);
        } catch { /* segue */ }
      }));
    }
  } catch (e) {
    console.warn(`backfill: erro lendo perguntas de ${userId}: ${(e as Error).message}`);
  }

  // 2. Devoluções/claims (sem alerta no backfill).
  try {
    const claims = await buscarClaimsSeller(token);
    for (const lote of chunk(claims, PARALELAS)) {
      await Promise.all(lote.map(async (claim) => {
        try {
          const ret = await buscarReturn(token, String(claim.id));
          await upsertDevolucao(admin, userId, orgId, claim, ret);
        } catch { /* segue */ }
      }));
    }
  } catch (e) {
    console.warn(`backfill: erro lendo claims de ${userId}: ${(e as Error).message}`);
  }

  // 3. Vendas
  let pedidos;
  try { pedidos = await buscarPedidosPeriodo(token, intervalo); } catch (e) {
    console.warn(`backfill: erro lendo pedidos da org ${orgId}: ${(e as Error).message}`);
    return 0;
  }
  const { idsPubliai, codigoResolver, eanResolver, infoPorGtin } = await carregarCatalogo(admin, userId);
  const [liquidoPorPayment, gtinPorItem] = await Promise.all([
    carregarLiquidoMP(token, Number(cx.contaExternaId)),
    carregarGtinsFallback(token, pedidos, idsPubliai),
  ]);
  // Varredura: derrubar o lote inteiro por um erro do MP é pior que seguir. preservarDadosMP
  // impede que o mapa vazio apague estorno/liberação já gravados, e o worker volta a estes pedidos.
  if (liquidoPorPayment === null) {
    console.warn(`backfill: leitura do MP falhou para a org ${orgId}; estorno/liberação preservados`);
  }

  let n = 0;
  const lotes = chunk(pedidos, PARALELAS);
  for (const lote of lotes) {
    await Promise.all(lote.map(async (pedido) => {
      try {
        const shippingId = pedido.shipping?.id ?? null;
        const [frete, shipment] = await Promise.all([
          buscarFreteVendedor(token, shippingId),
          buscarShipment(token, shippingId),
        ]);
        await upsertVenda(admin, userId, orgId, pedido, {
          freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem,
          liquidoPorPayment: liquidoPorPayment ?? undefined,
        });
        n++;
      } catch (e) {
        console.warn(`backfill: erro upsert pedido ${pedido.id}: ${(e as Error).message}`);
      }
    }));
  }

  // 4. Mensagens pós-venda (ADR-0067). Sem alerta no backfill — só popula o estado atual.
  //    Roda após as vendas para ter os packs em ml_vendas. 1 GET por pack.
  if (cx.contaExternaId) {
    try {
      const packs = await listarPacksDeVendas(admin, userId);
      const contaExternaId = cx.contaExternaId;
      for (const lote of chunk(packs, PARALELAS)) {
        await Promise.all(lote.map(async (p) => {
          try {
            const msgs = await buscarMensagensPack(token, p.packId, contaExternaId);
            if (msgs.length) await upsertMensagens(admin, userId, orgId, p.packId, p, contaExternaId, msgs);
          } catch { /* segue */ }
        }));
      }
    } catch (e) {
      console.warn(`backfill: erro lendo mensagens de ${userId}: ${(e as Error).message}`);
    }
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
  let context: Awaited<ReturnType<typeof requireUserOrg>> | null = null;
  if (temAssinatura) {
    if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  } else {
try { ({ orgId: scopedOrgId } = context = await requireUserOrg(req, { access: 'write' })); }
    catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  }

  let payload: Body = {};
  try {
    let parsed: unknown = body ? JSON.parse(body) : {};
    // O QStash pode guardar o body duplamente codificado (uma string contendo JSON). Foi
    // exatamente isso: o schedule tinha `"{\"dias\":30}"`, o parse devolvia uma string, `dias`
    // ficava undefined e a janela caía no default de 90 dias — carga que não cabe numa execução.
    // Passou despercebido por semanas porque falhava calado. Desembrulha e avisa alto.
    if (typeof parsed === 'string') {
      console.warn('backfill: body duplamente codificado (string em vez de objeto) — desembrulhando; corrija o schedule');
      parsed = JSON.parse(parsed);
    }
    if (parsed && typeof parsed === 'object') payload = parsed as Body;
  } catch { /* vazio */ }
  const intervalo = janela(payload);
  // A janela efetiva vai para o log: sem isso, cair no default é indistinguível de ter sido pedido.
  console.log(`backfill: janela efetiva ${intervalo.desde}..${intervalo.ate} (dias=${payload.dias ?? 'DEFAULT 90'})`);

  let query = admin.from('marketplace_connections').select('id, org_id, canal, conta_externa_id, expires_at, criado_por').eq('canal', 'mercado_livre');
  if (scopedOrgId) query = query.eq('org_id', scopedOrgId);
  const { data: conexoesRaw } = await query;

  let total = 0;
  let falhou = false;
  for (const row of (conexoesRaw ?? []) as ConexaoRow[]) {
    try {
      total += await processarConexao(admin, mapCx(row), intervalo);
    } catch (e) {
      falhou = true;
      console.error(`backfill-faturamento: falhou para org ${row.org_id}:`, e instanceof Error ? e.message : e);
    }
  }

  if (context && scopedOrgId) {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: scopedOrgId }, falhou ? 'failed' : 'succeeded');
  }

  return new Response(JSON.stringify({ ok: true, sincronizados: total }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
