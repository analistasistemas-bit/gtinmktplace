// ADR-0121: tratamento de pedido cancelado, compartilhado pelos DOIS gatilhos que o enxergam.
//
// Vivia inteiro dentro do sync-venda, que só roda por webhook `orders_v2`. Medido em 18/08/2026:
// os pedidos 2000017926934620 e 2000017939290244 (SKU 00000029) receberam UM único webhook — o da
// compra, ainda `paid`, que baixou o estoque — e nenhum no cancelamento. Quem gravou `cancelled`
// foi a reconciliação horária, que não tocava estoque nem avisava: zero linhas em `pos_venda` na
// org inteira, contra 888 em `vendas`. O saldo local ficou abaixo do físico, calado.
//
// A decisão de repor NÃO mudou (ADR-0094 D-7): só a allowlist de pré-despacho repõe, e todo o
// resto avisa. O que mudou é quem pode chamar.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { refBaixa, selecionarBaixas, type ItemVendaBaixa, type MovimentoPendente } from './baixa.ts';
import type { CategoriaNotificacao } from '../notificacoes/categorias.ts';
import { urlVendaML } from '../notificacoes/telegram.ts';
import { criarTransferencia } from '../kit-variacao/saga.ts';
import type { classificarItensKit, gravarIdentidades } from '../kit-variacao/venda.ts';

/** Estados de envio que provam que a mercadoria NÃO saiu. Allowlist, nunca denylist:
 *  `buscarShipment` devolve null em qualquer erro de rede, e tratar o desconhecido como
 *  "não despachado" reporia estoque de mercadoria já enviada. */
const PRE_DESPACHO = ['pending', 'handling', 'ready_to_ship'];

/** Rótulo do tipo de claim — espelha `TIPO_LABEL` de `src/lib/devolucoes.ts` (runtimes separados). */
const TIPO_CLAIM: Record<string, string> = {
  returns: 'Devolução', mediations: 'Mediação', cancel_purchase: 'Cancelamento (compra)',
  cancel_sale: 'Cancelamento (venda)', ml_case: 'Reclamação', fulfillment: 'Fulfillment',
};

/** Só para o texto do aviso: estados em que a mercadoria comprovadamente saiu. */
const SAIU = ['shipped', 'delivered', 'not_delivered'];

/** Rótulo pt-BR só para o texto da notificação — mesmos códigos de `ENVIO` em
 *  `src/lib/ml-status.ts`, duplicado aqui porque edge (Deno) e frontend não compartilham módulo.
 *  Sem entrada aqui, cai no código cru do ML (nunca quebra por status novo/desconhecido). */
const LABEL_ENVIO: Record<string, string> = {
  shipped: 'Enviado', delivered: 'Entregue', not_delivered: 'Não entregue', cancelled: 'Cancelado',
};

export interface DepsCancelamento {
  estornarVendaCancelada: (
    admin: SupabaseClient,
    p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
  ) => Promise<{ pendentesDePush: MovimentoPendente[]; falhas: Array<{ codigo: string; mensagem: string }>; aplicados: string[] }>;
  despacharPushPendente: (
    admin: SupabaseClient,
    orgId: string,
    pendentes: MovimentoPendente[],
    enfileirar: (job: { org_id: string; codigo_pai: string; canal_origem: string | null; reativar?: boolean }, orgId: string) => Promise<string>,
  ) => Promise<{ marcados: number; falhas: number }>;
  enfileirarSincronizacaoEstoque: (
    job: { org_id: string; codigo_pai: string; canal_origem: string | null; reativar?: boolean }, orgId: string,
  ) => Promise<string>;
  houveBaixaDeVenda: (
    admin: SupabaseClient,
    p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
  ) => Promise<boolean>;
  /** Claim mais recente do pedido (`ml_devolucoes`): o motivo real do cancelamento. */
  claimDoPedido: (
    admin: SupabaseClient, p: { orgId: string; orderId: string | number },
  ) => Promise<{ tipo: string; motivo: string | null; desfecho: string | null } | null>;
  reservarNotificacao: (
    admin: SupabaseClient, orgId: string, userId: string | null, entidade: string, chave: string,
  ) => Promise<boolean>;
  notificarCategoria: (
    admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string,
  ) => Promise<unknown>;
  /** ADR-0200: `skusParticipantes` de `kit-variacao/politica.ts`. Só chamado com o módulo ligado. */
  skusParticipantes: (admin: SupabaseClient, orgId: string, skus: string[], ligado: boolean) => Promise<Set<string>>;
  /** ADR-0200: `agendarCancelamentoKit` com `enfileirarSaga`. Devolve os movimentos de estorno já cobertos. */
  agendarCancelamentoKit: (
    admin: SupabaseClient, p: { orgId: string; canal: string; orderId: string | number; codigos: string[] },
  ) => Promise<string[]>;
  /** ADR-0200: `classificarItensKit` (identidade do item vendido). Lança em erro de leitura. */
  classificarItensKit: typeof classificarItensKit;
  /** ADR-0200: `gravarIdentidades` (a primeira resolução do item vence). Lança em erro. */
  gravarIdentidades: typeof gravarIdentidades;
  /** ADR-0200: RPC `registrar_pendencia_kit` (worker_pendencias obrigatória, sem descarte). Lança em erro. */
  registrarPendenciaKit: (admin: SupabaseClient, orgId: string, orderId: string, erro: string) => Promise<void>;
}

export interface PedidoCancelado {
  orgId: string;
  userId: string | null;
  canal: string;
  orderId: string | number;
  itens: ItemVendaBaixa[];
  statusPedido: string | null;
  /** `null` = o shipment não pôde ser lido. NUNCA equivale a "não despachado". */
  shipmentStatus: string | null;
  temEnvio: boolean;
  /** ADR-0200: módulo `kit_variacao` (`Catalogo.kitLigado`). Ausente = desligado, comportamento de hoje. */
  kitLigado?: boolean;
  /** ADR-0200: o catálogo que resolveu os códigos veio incompleto (`Catalogo.incompleto`). */
  catalogoIncompleto?: boolean;
}

export type ResultadoCancelamento =
  | 'reposto'
  | 'avisado'
  | 'sem-baixa' // cancelado, mas o estoque nunca desceu por este pedido — nada a conferir
  | 'silenciado' // aviso já dado antes (a reconciliação revisita o pedido de hora em hora)
  | 'pendente' // ADR-0200: crédito de SKU de kit com variação não confirmado; obrigação gravada em worker_pendencias
  | 'repetir' // ADR-0200: obrigação de crédito NÃO gravada; quem chama tem de repetir (502 / falha do pedido)
  | 'ignorado'
  | 'erro';

/**
 * ADR-0200: o pedido cai no crédito de kit com variação (cancelado, comprovadamente antes do despacho, módulo
 * ligado). É o único caminho que pode devolver `pendente`/`repetir`.
 */
export function entraNoCreditoKit(p: PedidoCancelado): boolean {
  if (p.statusPedido !== 'cancelled' || !p.kitLigado) return false;
  const st = p.shipmentStatus != null ? String(p.shipmentStatus) : null;
  return (st !== null && PRE_DESPACHO.includes(st)) || !p.temEnvio;
}

/**
 * Repõe o estoque de um pedido cancelado, ou avisa quando não dá para repor com segurança.
 *
 * Idempotente pelos dois lados: o estorno é idempotente por referência dentro da RPC e o aviso
 * passa por `reservarNotificacao`. Por isso pode ser chamado a cada varredura sem cuidado extra.
 *
 * Nunca lança: a venda já foi gravada e nada aqui pode derrubar o worker que a gravou.
 */
export async function tratarPedidoCancelado(
  admin: SupabaseClient, deps: DepsCancelamento, p: PedidoCancelado,
): Promise<ResultadoCancelamento> {
  if (p.statusPedido !== 'cancelled') return 'ignorado';

  const st = p.shipmentStatus != null ? String(p.shipmentStatus) : null;
  const preDespachoConhecido = st !== null && PRE_DESPACHO.includes(st);

  try {
    if (entraNoCreditoKit(p)) return await reporComKit(admin, deps, p);
    if (preDespachoConhecido || !p.temEnvio) {
      // A checagem "houve baixa?" vive dentro da RPC, atômica com o estorno — e quando não há
      // baixa ela grava o tombstone que impede a execução `paid` posterior de baixar um pedido
      // já cancelado.
      const { pendentesDePush } = await deps.estornarVendaCancelada(admin, {
        orgId: p.orgId, canal: p.canal, orderId: p.orderId, itens: p.itens,
      });
      // Os movimentos de estorno nascem com push_canal_origem = null, então a reposição alcança
      // TODOS os canais — inclusive o ML, que não repõe sozinho.
      await deps.despacharPushPendente(admin, p.orgId, pendentesDePush, deps.enfileirarSincronizacaoEstoque);
      return 'reposto';
    }
    // Sem baixa não há saldo devendo voltar: o aviso não teria o que pedir para conferir.
    // Sem este corte, a primeira varredura alerta todo cancelamento histórico da base de uma
    // vez — 26 pedidos, alguns de 2021, medido em 18/08/2026.
    if (!await deps.houveBaixaDeVenda(admin, {
      orgId: p.orgId, canal: p.canal, orderId: p.orderId, itens: p.itens,
    })) {
      return 'sem-baixa';
    }
    if (!await deps.reservarNotificacao(admin, p.orgId, p.userId, 'estoque_cancelado_despachado', String(p.orderId))) {
      return 'silenciado';
    }
    // Falha de leitura cai no texto genérico: o aviso já foi reservado e não pode se perder.
    const claim = await deps.claimDoPedido(admin, { orgId: p.orgId, orderId: p.orderId }).catch(() => null);
    const peloComprador = claim?.tipo === 'cancel_purchase';
    const situacaoEnvio = st === null ? 'Envio: não deu para consultar' : `Envio: ${LABEL_ENVIO[st] ?? st}`;
    const motivo = claim
      ? `Motivo: ${TIPO_CLAIM[claim.tipo] ?? claim.tipo}${claim.motivo ? ` — ${claim.motivo}` : ''}\n`
        + (claim.desfecho ? `Desfecho: ${claim.desfecho}\n` : '')
      : '';
    const saiu = st !== null && SAIU.includes(st);
    await deps.notificarCategoria(
      admin, p.orgId, 'pos_venda',
      peloComprador
        ? `🚫 Comprador cancelou o pedido ${p.orderId}\n\n`
          + 'O ML já resolveu: não precisa responder nada.\n\n'
          + 'O estoque NÃO foi reposto. Se a mercadoria ainda está aí, dê entrada manual em Estoque.'
        : `📦 Pedido ${p.orderId} cancelado — estoque NÃO reposto\n\n${motivo}${situacaoEnvio}\n`
          + (saiu
            ? 'A mercadoria já saiu, por isso o PubliAI não devolveu ao estoque sozinho.\n\n'
              + '👉 Quando o produto voltar, dê entrada manual em Estoque.'
            : 'Não dá para saber se a mercadoria saiu, por isso o PubliAI não devolveu ao estoque sozinho.\n\n'
              + '👉 Se o produto estiver aí, dê entrada manual em Estoque.')
          + `\n\n${urlVendaML(Number(p.orderId))}`,
    );
    return 'avisado';
  } catch (e) {
    console.error('estorno_estoque_falhou', p.orderId, e);
    return 'erro';
  }
}

/**
 * ADR-0200 (spec, contrato de segurança 9): pré-despacho com o módulo ligado. Credita como hoje; para SKU de kit
 * com variação creditado agora, cria a transferência `cancelamento` (escrita no ML só com o kit pausado), mesmo
 * com reposição automática desligada. Componente individual segue pelo outbox, que já vira transferência `entrada`.
 *
 * O SKU de cada item vem da identidade da baixa (`kit_venda_identidade`), não da resolução desta execução: assim
 * GTIN ou catálogo tolerante não estornam outra referência nem gravam tombstone numa que não existe. Item sem
 * identidade com leitura incerta e sem prova de ser comum fica pendente; os demais (comuns inclusive) creditam já.
 *
 * Crédito não confirmado de participante não é `reposto`: vira obrigação em `worker_pendencias` (sem descarte),
 * gravada antes de responder; se a gravação falha, `repetir`.
 */
async function reporComKit(
  admin: SupabaseClient, deps: DepsCancelamento, p: PedidoCancelado,
): Promise<ResultadoCancelamento> {
  // Causas transitórias, sem saber se há participante: pendência calada. Avisar aqui mandaria "crédito do kit não
  // confirmado" a todo cancelamento da org numa varredura com uma página ruim (a classe dos 26 avisos do ADR-0121).
  let itens: Awaited<ReturnType<DepsCancelamento['classificarItensKit']>>;
  try {
    itens = await deps.classificarItensKit(admin, {
      orgId: p.orgId, canal: p.canal, orderId: p.orderId, itens: p.itens, incerto: !!p.catalogoIncompleto,
    });
    // O cancelamento também fixa a identidade (a primeira vence): o tombstone e uma baixa tardia caem no mesmo
    // SKU, então a baixa que resolveria outro código não debita um pedido já cancelado.
    itens = { ...itens, certos: await deps.gravarIdentidades(admin, {
      orgId: p.orgId, canal: p.canal, orderId: p.orderId, itens: itens.certos,
    }) };
  } catch (e) {
    return await pendente(admin, deps, p, `identidade: ${String(e)}`, false);
  }
  const codigos = selecionarBaixas(itens.certos).map((b) => b.codigo);
  let participantes: Set<string>;
  try {
    participantes = await deps.skusParticipantes(admin, p.orgId, codigos, true);
  } catch (e) {
    return await pendente(admin, deps, p, `participantes: ${String(e)}`, false);
  }

  let r: Awaited<ReturnType<DepsCancelamento['estornarVendaCancelada']>>;
  try {
    r = await deps.estornarVendaCancelada(admin, { orgId: p.orgId, canal: p.canal, orderId: p.orderId, itens: itens.certos });
  } catch (e) {
    if (codigos.some((c) => participantes.has(c))) return await pendente(admin, deps, p, String(e), true);
    throw e;
  }

  let pendentes = r.pendentesDePush;
  const kit = r.aplicados.filter((c) => participantes.has(c));
  if (kit.length > 0) {
    try {
      const cobertos = new Set(await deps.agendarCancelamentoKit(admin, {
        orgId: p.orgId, canal: p.canal, orderId: p.orderId, codigos: kit,
      }));
      pendentes = pendentes.filter((m) => !cobertos.has(m.id));
    } catch (e) {
      // O crédito já está feito: o estorno segue no outbox, e o push vira transferência `entrada`.
      console.error('kit_cancelamento_agendar_falhou', p.orderId, String(e));
    }
  }
  await deps.despacharPushPendente(admin, p.orgId, pendentes, deps.enfileirarSincronizacaoEstoque);

  const falhasKit = r.falhas.filter((f) => participantes.has(f.codigo));
  if (falhasKit.length > 0) {
    return await pendente(admin, deps, p, falhasKit.map((f) => `${f.codigo}: ${f.mensagem}`).join('; '), true);
  }
  if (itens.incertos.length > 0) {
    return await pendente(admin, deps, p, `identidade incerta: ${itens.incertos.map((i) => i.ml_item_id ?? i.codigo).join(', ')}`, false);
  }
  return 'reposto';
}

/**
 * Grava a obrigação ANTES de responder; sem gravação, `repetir`. `avisar` só quando o crédito de participante falhou
 * de fato; o aviso sai uma vez por pedido.
 */
async function pendente(
  admin: SupabaseClient, deps: DepsCancelamento, p: PedidoCancelado, erro: string, avisar: boolean,
): Promise<'pendente' | 'repetir'> {
  console.error('kit_cancelamento_pendente', p.orderId, erro);
  try {
    await deps.registrarPendenciaKit(admin, p.orgId, String(p.orderId), `kit_cancelamento: ${erro}`);
  } catch (e) {
    console.error('kit_cancelamento_pendencia_falhou', p.orderId, String(e));
    return 'repetir';
  }
  if (!avisar) return 'pendente';
  try {
    if (await deps.reservarNotificacao(admin, p.orgId, p.userId, 'estoque_cancelado_kit_pendente', String(p.orderId))) {
      await deps.notificarCategoria(
        admin, p.orgId, 'estoque',
        `⏳ Pedido ${p.orderId} cancelado antes do envio\n\n`
          + 'O crédito do kit com variação ainda não foi confirmado. O PubliAI tenta de novo sozinho na reconciliação. '
          + 'Não dê entrada manual: ela somaria duas vezes.',
      );
    }
  } catch (e) {
    console.error('kit_cancelamento_aviso_falhou', p.orderId, String(e));
  }
  return 'pendente';
}

/**
 * ADR-0200: cria a transferência `cancelamento` de cada kit cujo SKU foi creditado, com os alvos do push
 * (`transferirParaSaga`: UP + cópia de catálogo), enfileira a saga e marca o estorno desses SKUs como entregue
 * no outbox. Sem a marca, o push criaria uma `entrada` que disputa a exclusão e pausaria o kit outra vez.
 *
 * SKU que não é de kit (componente) ou sem item vivo (retirado): nada aqui; o crédito local fica e o outbox
 * segue. Recusa (`up_ocupado`): também nada, o outbox repete pela `entrada`. Erro de leitura lança.
 */
export async function agendarCancelamentoKit(
  admin: SupabaseClient,
  enfileirarSaga: (id: string, orgId: string) => Promise<void>,
  p: { orgId: string; canal: string; orderId: string | number; codigos: string[] },
  /** Emenda "Encerrar kit": crédito em SKU de kit encerrado vira aviso de saldo preso (`avisarKitsEncerrados`). */
  avisarEncerrados?: () => Promise<unknown>,
): Promise<string[]> {
  const { data: lidos, error } = await admin.from('kit_variacao_skus')
    .select('codigo, kit_id, kits_variacao(status)').eq('org_id', p.orgId).in('codigo', p.codigos);
  if (error) throw new Error(`kit_variacao_skus: ${error.message}`);
  // Kit encerrando/encerrado não recebe transferência (a guarda do banco recusaria): o crédito fica local e avisa.
  const statusDe = (s: Record<string, unknown>) => {
    const k = s.kits_variacao as { status?: string } | Array<{ status?: string }> | null | undefined;
    return (Array.isArray(k) ? k[0] : k)?.status;
  };
  const encerrados = (lidos ?? []).filter((s) => ['encerrando', 'encerrado'].includes(statusDe(s) ?? ''));
  if (encerrados.length > 0 && avisarEncerrados) {
    await avisarEncerrados().catch((e) => console.error('kit_encerrado_estorno_aviso_falhou', p.orderId, String(e)));
  }
  const skus = (lidos ?? []).filter((s) => !encerrados.includes(s));
  if (skus.length === 0) return [];

  const { data: itens, error: e2 } = await admin.from('anuncios_externos_itens')
    .select('sku, item_externo_id, user_product_id, catalog_listing_id')
    .eq('org_id', p.orgId).eq('retirado', false).in('sku', (skus ?? []).map((s) => s.codigo as string));
  if (e2) throw new Error(`anuncios_externos_itens: ${e2.message}`);

  const porKit = new Map<string, Array<{ codigo: string; upId: string; itemIds: string[] }>>();
  for (const s of skus ?? []) {
    const i = (itens ?? []).find((x) => x.sku === s.codigo && x.user_product_id && x.item_externo_id);
    if (!i) continue;
    const alvos = porKit.get(s.kit_id as string) ?? [];
    alvos.push({
      codigo: s.codigo as string, upId: i.user_product_id as string,
      itemIds: [i.item_externo_id as string, ...(i.catalog_listing_id ? [i.catalog_listing_id as string] : [])],
    });
    porKit.set(s.kit_id as string, alvos);
  }

  const cobertos: string[] = [];
  for (const [kitId, alvos] of porKit) {
    const r = await criarTransferencia(admin, {
      orgId: p.orgId, kitId, tipo: 'cancelamento', itens: alvos.map((a) => ({ codigo: a.codigo, quantidade: 0 })), alvos,
    });
    if (!('id' in r)) {
      console.error('kit_transferencia_cancelamento_recusada', p.orgId, kitId, r.motivo);
      continue;
    }
    await enfileirarSaga(r.id, p.orgId);
    cobertos.push(...alvos.map((a) => a.codigo));
  }
  if (cobertos.length === 0) return [];

  const { data: marcados, error: e3 } = await admin.from('estoque_movimentos')
    .update({ push_enfileirado_em: new Date().toISOString() })
    .eq('org_id', p.orgId).is('push_enfileirado_em', null)
    .in('referencia_externa', cobertos.map((c) => `estorno:${refBaixa(p.canal, p.orderId, c)}`))
    .select('id');
  if (e3) {
    console.error('kit_cancelamento_marcar_falhou', p.orderId, e3.message);
    return [];
  }
  return (marcados ?? []).map((m) => m.id as string);
}
