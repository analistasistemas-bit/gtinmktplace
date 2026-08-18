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
import type { ItemVendaBaixa, MovimentoPendente } from './baixa.ts';
import type { CategoriaNotificacao } from '../notificacoes/categorias.ts';

/** Estados de envio que provam que a mercadoria NÃO saiu. Allowlist, nunca denylist:
 *  `buscarShipment` devolve null em qualquer erro de rede, e tratar o desconhecido como
 *  "não despachado" reporia estoque de mercadoria já enviada. */
const PRE_DESPACHO = ['pending', 'handling', 'ready_to_ship'];

export interface DepsCancelamento {
  estornarVendaCancelada: (
    admin: SupabaseClient,
    p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
  ) => Promise<{ pendentesDePush: MovimentoPendente[]; falhas: Array<{ codigo: string; mensagem: string }> }>;
  despacharPushPendente: (
    admin: SupabaseClient,
    orgId: string,
    pendentes: MovimentoPendente[],
    enfileirar: (job: { org_id: string; codigo_pai: string; canal_origem: string | null; reativar?: boolean }, orgId: string) => Promise<string>,
  ) => Promise<{ marcados: number; falhas: number }>;
  enfileirarSincronizacaoEstoque: (
    job: { org_id: string; codigo_pai: string; canal_origem: string | null; reativar?: boolean }, orgId: string,
  ) => Promise<string>;
  reservarNotificacao: (
    admin: SupabaseClient, orgId: string, userId: string | null, entidade: string, chave: string,
  ) => Promise<boolean>;
  notificarCategoria: (
    admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string,
  ) => Promise<unknown>;
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
}

export type ResultadoCancelamento =
  | 'reposto'
  | 'avisado'
  | 'silenciado' // aviso já dado antes (a reconciliação revisita o pedido de hora em hora)
  | 'ignorado'
  | 'erro';

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
    if (!await deps.reservarNotificacao(admin, p.orgId, p.userId, 'estoque_cancelado_despachado', String(p.orderId))) {
      return 'silenciado';
    }
    await deps.notificarCategoria(
      admin, p.orgId, 'pos_venda',
      `📦 Pedido ${p.orderId} cancelado, mas o envio ${st === null ? 'não pôde ser consultado' : `está em "${st}"`}.\n\n`
      + 'O estoque NÃO foi reposto automaticamente — confira o que voltou e dê entrada manual.',
    );
    return 'avisado';
  } catch (e) {
    console.error('estorno_estoque_falhou', p.orderId, e);
    return 'erro';
  }
}
