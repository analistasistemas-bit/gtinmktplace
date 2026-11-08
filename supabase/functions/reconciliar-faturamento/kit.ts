// ADR-0199 (Task 8): o desfecho do crédito de kit com variação entra no desfecho do claim e do pedido. Sem crédito
// nem obrigação gravada (`repetir`), nada pode marcar o trabalho como feito.
import { entraNoCreditoKit, type PedidoCancelado, type ResultadoCancelamento } from '../_shared/estoque/cancelamento.ts';

export interface IoClaim {
  kitLigado: boolean;
  /** Pedido do claim sem gravar a devolução (só chamado com o módulo). */
  resolverPedido: () => Promise<{ ignorado: boolean; orderId: number | null }>;
  /** `upsertDevolucao`: é o que tira o claim do filtro da próxima varredura. */
  gravarDevolucao: () => Promise<{ ignorado: boolean; orderId: number | null }>;
  /** Busca o pedido, grava a venda e monta a entrada do cancelamento. */
  prepararPedido: (orderId: number) => Promise<PedidoCancelado>;
  tratar: (p: PedidoCancelado) => Promise<ResultadoCancelamento>;
}

const NAO_GRAVADA = 'kit_cancelamento: obrigação de crédito não gravada';

/**
 * Um claim. Sem o módulo: a ordem de hoje (devolução, pedido, cancelamento), sem consulta nova. Com o módulo e
 * pedido no crédito de kit: cancelamento ANTES da devolução; `repetir` lança sem gravar a devolução, então o
 * claim continua no filtro e conta como falha. Fora do crédito de kit, a devolução vem antes (o aviso pós-despacho
 * lê o `cancel_purchase` dela).
 */
export async function processarClaim(io: IoClaim): Promise<void> {
  if (!io.kitLigado) {
    const d = await io.gravarDevolucao();
    if (d.ignorado || d.orderId == null) return;
    await io.tratar(await io.prepararPedido(d.orderId));
    return;
  }
  const r = await io.resolverPedido();
  if (r.ignorado || r.orderId == null) {
    await io.gravarDevolucao();
    return;
  }
  const p = await io.prepararPedido(r.orderId);
  if (entraNoCreditoKit(p)) {
    if (await io.tratar(p) === 'repetir') throw new Error(NAO_GRAVADA);
    await io.gravarDevolucao();
    return;
  }
  await io.gravarDevolucao();
  if (await io.tratar(p) === 'repetir') throw new Error(NAO_GRAVADA);
}

/**
 * Desfecho de um pedido na varredura de vendas/pendências. `repetir` lança (falha do pedido, vira pendência);
 * `pendente` ou baixa adiada não é sucesso (a obrigação gravada não pode ser apagada pelo "ok").
 */
export function desfechoKit(p: { mpLido: boolean; cancelamento: ResultadoCancelamento; baixaOk: boolean }): boolean {
  if (p.cancelamento === 'repetir') throw new Error(NAO_GRAVADA);
  return p.mpLido && p.cancelamento !== 'pendente' && p.baixaOk;
}
