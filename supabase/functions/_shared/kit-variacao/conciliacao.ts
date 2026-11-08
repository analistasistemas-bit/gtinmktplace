// ADR-0199: conta da reserva antes de escrever quantidade em anúncio pausado. Pura; a leitura do ML
// fica em ml-oferta.ts. `duvida: true` bloqueia a operação, e então `reservado` não vale nada.
import type { PedidoML } from '../faturamento/venda.ts';

export type PedidoPendente = Pick<PedidoML, 'id' | 'order_items' | 'payments'> & Partial<Pick<PedidoML, 'status'>>;
export type PedidoPago = Pick<PedidoML, 'id' | 'order_items' | 'date_closed'>;

const finito = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Ids que a saga guarda no passo 1. Vale qualquer pagamento: `rejected` pode tentar de novo e pagar
 * na quarentena, e pedido criado antes da janela de `importarPedidosDoItem` só é achado pelo id.
 */
export function idsDoItem(itemIds: string[], pendentes: PedidoPendente[]): string[] {
  const doUp = new Set(itemIds);
  return pendentes
    .filter((o) => (o.order_items ?? []).some((oi) => doUp.has(oi?.item?.id ?? '')))
    .map((o) => String(o.id));
}

/**
 * `null` em qualquer campo é leitura que falhou: quem chama pega o erro e passa `null` aqui.
 * `pendentes` é a lista atual seguida dos `naoPagos` da importação: o mesmo id fica com a última leitura.
 */
export function calcularReserva(p: {
  itemIds: string[];
  pendentes: PedidoPendente[] | null;
  pagosRecentes: PedidoPago[] | null;
  /** De `idsDoItem`, gravados no passo 1. Cada um precisa reaparecer em `pendentes` ou em `pagosRecentes`. */
  idsPasso1: string[] | null;
  qtdPasso1: number | null;
  qtdAgora: number | null;
}): { reservado: number; duvida: boolean } {
  const { pendentes, pagosRecentes, idsPasso1, qtdPasso1, qtdAgora } = p;
  if (!pendentes || !pagosRecentes || !idsPasso1 || !finito(qtdPasso1) || !finito(qtdAgora)) {
    return { reservado: 0, duvida: true };
  }

  const doUp = new Set(p.itemIds);
  let duvida = false;
  // Soma a quantidade dos itens do UP, nunca o número de pedidos (Review Focus 2).
  const qtdNoUp = (pedido: Pick<PedidoML, 'order_items'>): number => {
    const itens = pedido.order_items ?? [];
    if (itens.length === 0) duvida = true;
    let total = 0;
    for (const oi of itens) {
      const id = oi?.item?.id;
      if (!id) { duvida = true; continue; }
      if (!doUp.has(id)) continue;
      const q = oi?.quantity;
      if (typeof q === 'number' && Number.isInteger(q) && q > 0) total += q;
      else duvida = true;
    }
    return total;
  };

  const pagos = new Map(pagosRecentes.map((o) => [String(o.id), o]));
  const totalPago = [...pagos.values()].reduce((soma, o) => soma + qtdNoUp(o), 0);
  // Sem data não dá para saber se a leitura do passo 1 já incluía o pedido.
  if ([...pagos.values()].some((o) => Number.isNaN(Date.parse(o.date_closed ?? '')))) duvida = true;

  const abertos = new Map(pendentes.map((o) => [String(o.id), o]));
  // Pedido do passo 1 que sumiu pode ter pago, e a queda dele soltaria outro pago ainda sem baixa.
  if (idsPasso1.some((id) => !pagos.has(id) && !abertos.has(id))) duvida = true;

  let reservadoPendente = 0;
  for (const [id, o] of abertos) {
    // Aprovado entre as duas leituras: já está em `pagos`, e contar de novo reservaria em dobro.
    if (pagos.has(id) || o.status === 'cancelled') continue;
    const qtd = qtdNoUp(o);
    if (qtd === 0) continue;
    const status = (o.payments ?? []).map((pg) => pg?.status);
    if (status.includes('pending')) reservadoPendente += qtd;
    // Abandonado fica `payment_required` para sempre, só com `cancelled` ou `rejected` (medido em 07/11).
    else if (status.length === 0 || status.some((s) => s !== 'cancelled' && s !== 'rejected')) duvida = true;
  }

  // Só a queda da quantidade lida solta pago. Queda parcial não diz qual pedido baixou, então
  // reserva o total. `last_updated` não solta: não está medido que anda só com a quantidade.
  const queda = qtdPasso1 - qtdAgora;
  if (queda < 0 || queda > totalPago) duvida = true;
  return { reservado: reservadoPendente + (queda >= totalPago ? 0 : totalPago), duvida };
}

/**
 * Recorta os pagos que a leitura do passo 1 pode não ter visto. Pago antigo já está na quantidade
 * do passo 1 e, sem o recorte, ficaria reservado sem nunca soltar. Data ilegível fica, e vira dúvida
 * em `calcularReserva`.
 *
 * `date_closed` veio de 0 a 39 s depois de `date_approved` em 100 pedidos (DSA e Daludi, 07/11):
 * o atraso só mantém pedido a mais.
 */
export function pagosDesde(pagos: PedidoPago[], instante: string): PedidoPago[] {
  const limite = Date.parse(instante);
  if (Number.isNaN(limite)) throw new Error(`pagosDesde: instante inválido (${instante})`);
  return pagos.filter((o) => {
    const data = Date.parse(o.date_closed ?? '');
    return Number.isNaN(data) || data >= limite;
  });
}
