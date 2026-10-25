// Notificação gerencial por carrinho (ADR-0190 D-2/D-4): estado durável em `notificacao_carrinho`
// + jobs QStash agendados para a edge `notificar-carrinho` + varredura de linhas paradas.
// "No máximo uma" mensagem por carrinho: o worker faz TODAS as leituras, depois o update condicional
// `status aguardando → enviado` e só quem afetou a linha notifica — pelo caminho com chave
// (`vendas_gerencial:{chave}`, idempotente por usuário e por chat). Se notificar lançar, a linha volta
// a `aguardando` e o erro sobe (500 → retry do QStash; a chave impede envio duplo).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../../queue.ts';
import { enfileirarEmBlocos } from '../../enfileirar-em-blocos.ts';
import { notificarCategoria, temAssinanteGerencial } from '../config.ts';
import { carregarContexto, lerVendasDoCarrinho, type MetricsDb } from '../../platform-admin/metrics-repository.ts';
import { ehFaturavel } from '../../platform-admin/sales-summary.ts';
import { resolverConexao } from '../../canais/conexao.ts';
import { getValidAccessTokenConexao } from '../../ml/token.ts';
import type { PedidoML } from '../../faturamento/venda.ts';
import { decidirEnvioCarrinho, PRAZO_CARRINHO_SEG, type EstadoCarrinho } from './carrinho.ts';
import { diaBrt, janelaDia, janelasMesCorrente } from './janelas.ts';
import { lerKpis } from './kpis.ts';
import { montarMensagemCarrinho } from './mensagens.ts';
import { resultadoCarrinho, resultadoPorItem } from './resultado.ts';

const TABELA = 'notificacao_carrinho';
const API = 'https://api.mercadolibre.com';
const DELAY_INICIAL_SEG = 20;
/** Atraso máximo entre o pagamento e o 1º sync para ainda registrar o carrinho (ver registrarCarrinho). */
const ATRASO_MAXIMO_S = 7200;
const LOTE_VARREDURA = 200;
const PARADA_MS = 90_000;

const urlWorker = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/notificar-carrinho`;
const dedup = (orgId: string, chave: string, tentativas: number) => `carrinho-${orgId}-${chave}-${tentativas}`;
const job = (orgId: string, chave: string, tentativas: number, delay?: number) => ({
  url: urlWorker(), body: { orgId, chave }, retries: 3, deduplicationId: dedup(orgId, chave, tentativas),
  ...(delay !== undefined ? { delay } : {}),
});

/** `GET /packs/{id}` → ids das orders do carrinho. Erro ou formato inesperado → null (nunca lança). */
export async function buscarOrdersDoPack(token: string, packId: number): Promise<number[] | null> {
  try {
    const resp = await fetch(`${API}/packs/${packId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const corpo = await resp.json() as { orders?: unknown };
    if (!Array.isArray(corpo?.orders) || corpo.orders.length === 0) return null;
    const ids = corpo.orders.map((o) => Number((o as { id?: unknown })?.id));
    return ids.every((id) => Number.isSafeInteger(id) && id > 0) ? ids : null;
  } catch {
    return null;
  }
}

/** Grava `esperadas` só se a linha ainda estiver aguardando sem composição (outro fluxo pode ter gravado). */
async function completarEsperadas(admin: SupabaseClient, orgId: string, chave: string, esperadas: number[]): Promise<void> {
  const { error } = await admin.from(TABELA).update({ esperadas })
    .eq('org_id', orgId).eq('chave', chave).eq('status', 'aguardando').is('esperadas', null);
  if (error) throw new Error(`completar esperadas: ${error.message}`);
}

/** Chamado pelo sync-venda a cada sync de order paga. Best-effort: NUNCA lança (a venda é sagrada).
 *  Idempotente pela PK; só quem insere a linha publica o 1º job — falha nessa publicação deixa a
 *  linha `aguardando` para a varredura. */
export async function registrarCarrinho(
  admin: SupabaseClient, token: string, orgId: string, pedido: PedidoML,
): Promise<void> {
  if (pedido.status !== 'paid') return;
  try {
    // Corte de histórico: a reconciliação ressincroniza 72 h de pedidos pagos (e webhooks de envio
    // reprocessam pedidos antigos); sem corte, cada carrinho antigo viraria mensagem gerencial quando
    // a org assina. Pago há > 2 h → histórico, não registra. Entre 600 s e 2 h (indisponibilidade
    // temporária) → registra e, com o prazo já vencido, o 1º job sai com delay 0 e envia o que houver.
    const pagoEm = Date.parse(pedido.date_closed ?? '') || Date.now();
    const decorridoS = (Date.now() - pagoEm) / 1000;
    if (decorridoS > ATRASO_MAXIMO_S) return;
    if (!await temAssinanteGerencial(admin, orgId, 'vendas_gerencial')) return;

    const orderId = Number(pedido.id);
    const packId = pedido.pack_id != null ? Number(pedido.pack_id) : null;
    const chave = String(packId ?? orderId);
    const { data: atual, error } = await admin.from(TABELA).select('status, esperadas')
      .eq('org_id', orgId).eq('chave', chave).maybeSingle();
    if (error) throw new Error(`ler carrinho: ${error.message}`);

    if (atual) {
      if (atual.status === 'aguardando' && atual.esperadas == null && packId != null) {
        const esperadas = await buscarOrdersDoPack(token, packId);
        if (esperadas) await completarEsperadas(admin, orgId, chave, esperadas);
      }
      return;
    }

    const esperadas = packId != null ? await buscarOrdersDoPack(token, packId) : [orderId];
    const { data: novas, error: errUpsert } = await admin.from(TABELA)
      .upsert(
        { org_id: orgId, chave, pack_id: packId, order_id: orderId, esperadas, primeiro_em: new Date(pagoEm).toISOString() },
        { onConflict: 'org_id,chave', ignoreDuplicates: true },
      )
      .select('chave');
    if (errUpsert) throw new Error(`registrar carrinho: ${errUpsert.message}`);
    if (!novas?.length) return; // outra execução registrou e publicou
    // Teto absoluto: o 1º job nunca passa de primeiro_em + 600 s.
    const delay = Math.max(0, Math.min(DELAY_INICIAL_SEG, Math.ceil(PRAZO_CARRINHO_SEG - decorridoS)));
    await qstashClient().publishJSON(job(orgId, chave, 0, delay));
  } catch (e) {
    console.error(`registrarCarrinho(org=${orgId}, order=${pedido.id}): ${(e as Error).message}`);
  }
}

/** Retry de `/packs` no worker, com o token da conexão ML da org (como o sync-venda). Nunca lança. */
async function composicaoNoWorker(admin: SupabaseClient, orgId: string, packId: number): Promise<number[] | null> {
  try {
    const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!conexao) return null;
    return await buscarOrdersDoPack(await getValidAccessTokenConexao(conexao), packId);
  } catch {
    return null;
  }
}

/** Uma execução do job do carrinho. Lança em erro de leitura antes do claim (a edge devolve 500 e
 *  o QStash tenta de novo; a linha segue `aguardando`). */
export async function processarCarrinho(
  admin: SupabaseClient, orgId: string, chave: string, agora: Date,
): Promise<'aguardando' | 'enviado' | 'descartado' | 'ignorado'> {
  const { data: l, error } = await admin.from(TABELA)
    .select('chave, pack_id, order_id, esperadas, primeiro_em, status, tentativas')
    .eq('org_id', orgId).eq('chave', chave).maybeSingle();
  if (error) throw new Error(`ler carrinho: ${error.message}`);
  if (!l || l.status !== 'aguardando') return 'ignorado';

  const e: EstadoCarrinho = {
    chave, packId: l.pack_id != null ? Number(l.pack_id) : null, orderId: Number(l.order_id),
    esperadas: l.esperadas ? (l.esperadas as unknown[]).map(Number) : null,
    primeiroEm: l.primeiro_em as string, tentativas: Number(l.tentativas),
  };
  if (e.esperadas == null && e.packId != null && e.tentativas >= 1) {
    const esperadas = await composicaoNoWorker(admin, orgId, e.packId);
    if (esperadas) {
      await completarEsperadas(admin, orgId, chave, esperadas);
      e.esperadas = esperadas;
    }
  }

  const db = admin as unknown as MetricsDb;
  const vendas = await lerVendasDoCarrinho(db, orgId, { packId: e.packId, orderId: e.orderId });
  const pagas = vendas.filter((v) => ehFaturavel(v.status)).map((v) => v.order_id);
  const decisao = decidirEnvioCarrinho(e, pagas, agora);
  console.log(JSON.stringify({ fn: 'notificar-carrinho', orgId, chave, decisao }));

  if (decisao.acao === 'aguardar') {
    // CAS em `tentativas`: retry do QStash e job da varredura na mesma linha não abrem duas cadeias.
    const { data, error: errUpd } = await admin.from(TABELA)
      .update({ tentativas: e.tentativas + 1, atualizado_em: agora.toISOString() })
      .eq('org_id', orgId).eq('chave', chave).eq('status', 'aguardando').eq('tentativas', e.tentativas)
      .select('chave');
    if (errUpd) throw new Error(`reagendar carrinho: ${errUpd.message}`);
    if (!data?.length) return 'ignorado';
    await qstashClient().publishJSON(job(orgId, chave, e.tentativas + 1, decisao.delaySeg));
    return 'aguardando';
  }

  if (decisao.acao === 'descartar') {
    const { error: errUpd } = await admin.from(TABELA)
      .update({ status: 'descartado', atualizado_em: agora.toISOString() })
      .eq('org_id', orgId).eq('chave', chave).eq('status', 'aguardando');
    if (errUpd) throw new Error(`descartar carrinho: ${errUpd.message}`);
    return 'descartado';
  }

  // enviar — toda leitura ANTES do claim.
  const maisAntiga = vendas.map((v) => v.date_closed ?? v.date_created).filter((d): d is string => !!d).sort()[0];
  const ctx = await carregarContexto(db, orgId, janelaDia(diaBrt(maisAntiga ? new Date(maisAntiga) : agora)).desde);
  const carrinho = resultadoCarrinho(resultadoPorItem(vendas, ctx), ctx.configOk);
  const jm = janelasMesCorrente(agora);
  const [hoje, mes, anterior] = await Promise.all([
    lerKpis(admin, orgId, janelaDia(diaBrt(agora))), lerKpis(admin, orgId, jm.mes), lerKpis(admin, orgId, jm.anterior),
  ]);
  const texto = montarMensagemCarrinho(
    carrinho, { hoje, mes, anterior, rotuloMes: jm.rotuloMes, rotuloAnterior: jm.rotuloAnterior }, Number(chave),
    { parcial: decisao.parcial, composicaoIncerta: decisao.composicaoIncerta },
  );

  const { data: claim, error: errClaim } = await admin.from(TABELA)
    .update({ status: 'enviado', atualizado_em: agora.toISOString() })
    .eq('org_id', orgId).eq('chave', chave).eq('status', 'aguardando')
    .select('chave');
  if (errClaim) throw new Error(`marcar carrinho enviado: ${errClaim.message}`);
  if (!claim?.length) return 'ignorado';
  try {
    await notificarCategoria(admin, orgId, 'vendas_gerencial', texto, { chave: `vendas_gerencial:${chave}` });
  } catch (e) {
    const { error: errVolta } = await admin.from(TABELA)
      .update({ status: 'aguardando', atualizado_em: agora.toISOString() })
      .eq('org_id', orgId).eq('chave', chave).eq('status', 'enviado');
    if (errVolta) console.error(`carrinho ${orgId}/${chave}: reverter claim: ${errVolta.message}`);
    throw e;
  }
  return 'enviado';
}

/** Varredura (rede de segurança): linhas `aguardando` sem avanço há > 90 s ganham o job individual de
 *  novo (mesmo dedup da tentativa atual). Não calcula nada. Lote de 200 por cursor `(org_id, chave)`;
 *  lote cheio publica a própria continuação. Retorna quantos jobs publicou. */
export async function varrerCarrinhos(
  admin: SupabaseClient, agora: Date, depois?: { orgId: string; chave: string },
): Promise<number> {
  let q = admin.from(TABELA).select('org_id, chave, tentativas')
    .eq('status', 'aguardando').lt('atualizado_em', new Date(agora.getTime() - PARADA_MS).toISOString());
  if (depois) q = q.or(`org_id.gt.${depois.orgId},and(org_id.eq.${depois.orgId},chave.gt.${depois.chave})`);
  const { data, error } = await q.order('org_id').order('chave').range(0, LOTE_VARREDURA - 1);
  if (error) throw new Error(`varrer carrinhos: ${error.message}`);
  const linhas = (data ?? []) as Array<{ org_id: string; chave: string; tentativas: number }>;
  if (linhas.length === 0) return 0;
  await enfileirarEmBlocos(linhas, (l) => job(l.org_id, l.chave, l.tentativas), (msgs) => qstashClient().batchJSON(msgs));
  if (linhas.length === LOTE_VARREDURA) {
    const ultima = linhas[linhas.length - 1];
    await qstashClient().publishJSON({
      url: urlWorker(), body: { varrer: true, depois: { orgId: ultima.org_id, chave: ultima.chave } }, retries: 3,
    });
  }
  return linhas.length;
}
