import { describe, it, expect } from 'vitest';
import { tratarPedidoCancelado, type DepsCancelamento } from '../cancelamento';

/**
 * ADR-0121 — o tratamento de pedido cancelado passou a ter DOIS gatilhos (webhook e
 * reconciliação), então a decisão "repõe ou só avisa" saiu do sync-venda para cá.
 *
 * O que os testes travam: a allowlist de pré-despacho continua sendo a ÚNICA porta que repõe
 * (ADR-0094 D-7, falha fechada), e todo o resto — inclusive envio `cancelled`, que é o caso dos
 * pedidos que originaram o ADR — avisa sem tocar no saldo.
 */
function fakeDeps(over: Partial<DepsCancelamento> = {}) {
  const chamadas = {
    estornos: [] as Array<{ orderId: string | number; itens: unknown[] }>,
    despachos: 0,
    notificacoes: [] as Array<{ categoria: string; texto: string }>,
    reservas: [] as Array<{ entidade: string; chave: string }>,
    consultasDeBaixa: 0,
  };
  const deps: DepsCancelamento = {
    estornarVendaCancelada: (_admin, p) => {
      chamadas.estornos.push({ orderId: p.orderId, itens: p.itens });
      return Promise.resolve({ pendentesDePush: [{ id: 'm1', codigoPai: 'P1', canalOrigem: null, reposicao: true }], falhas: [] });
    },
    despacharPushPendente: () => {
      chamadas.despachos++;
      return Promise.resolve({ marcados: 1, falhas: 0 });
    },
    enfileirarSincronizacaoEstoque: () => Promise.resolve('msg-1'),
    houveBaixaDeVenda: () => {
      chamadas.consultasDeBaixa++;
      return Promise.resolve(true);
    },
    reservarNotificacao: (_admin, _org, _user, entidade, chave) => {
      chamadas.reservas.push({ entidade, chave });
      return Promise.resolve(true);
    },
    notificarCategoria: (_admin, _org, categoria, texto) => {
      chamadas.notificacoes.push({ categoria, texto });
      return Promise.resolve();
    },
    ...over,
  };
  return { chamadas, deps };
}

// deno-lint-ignore no-explicit-any
const ADMIN = {} as any;
const BASE = {
  orgId: 'org-1',
  userId: 'user-1',
  canal: 'mercado_livre',
  orderId: 2000017926934620,
  itens: [{ codigo: '00000029', quantity: 1 }],
  statusPedido: 'cancelled',
  temEnvio: true,
};

describe('tratarPedidoCancelado — repõe só antes do despacho', () => {
  it.each(['pending', 'handling', 'ready_to_ship'])('envio em "%s" repõe e despacha o push', async (st) => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: st });
    expect(r).toBe('reposto');
    expect(chamadas.estornos).toHaveLength(1);
    expect(chamadas.despachos).toBe(1);
    expect(chamadas.notificacoes).toHaveLength(0);
  });

  it('pedido sem envio repõe', async () => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, temEnvio: false, shipmentStatus: null });
    expect(r).toBe('reposto');
    expect(chamadas.estornos).toHaveLength(1);
  });
});

describe('tratarPedidoCancelado — o que não é pré-despacho apenas avisa', () => {
  // Caso real dos pedidos 2000017926934620/2000017939290244 (14/08/2026): cancelados por
  // mediação, envio `cancelled`, com devolução. A mercadoria pode ter saído — repor criaria
  // estoque fantasma, que é exatamente o oversell que o ADR existe para não ampliar.
  it('envio cancelled avisa e NÃO estorna', async () => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'cancelled' });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
    expect(chamadas.despachos).toBe(0);
    expect(chamadas.notificacoes[0].categoria).toBe('pos_venda');
    expect(chamadas.notificacoes[0].texto).toContain('Cancelado');
    expect(chamadas.reservas[0]).toEqual({ entidade: 'estoque_cancelado_despachado', chave: String(BASE.orderId) });
  });

  it('envio entregue avisa e NÃO estorna', async () => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'delivered' });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
  });

  // buscarShipment devolve null em QUALQUER erro de rede — tratar null como "não despachado"
  // reporia mercadoria que saiu (falha fechada, ADR-0094 D-7).
  it('shipment ilegível avisa que não pôde ser consultado', async () => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: null });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
    expect(chamadas.notificacoes[0].texto).toContain('não deu para consultar o envio');
  });

  // Sem este corte a primeira varredura alertaria todo cancelamento histórico da base de uma vez
  // (26 pedidos, alguns de 2021, medido em 18/08/2026) — in-app E no Telegram.
  it('pedido que nunca baixou estoque não vira alerta', async () => {
    const { chamadas, deps } = fakeDeps({ houveBaixaDeVenda: () => Promise.resolve(false) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'delivered' });
    expect(r).toBe('sem-baixa');
    expect(chamadas.notificacoes).toHaveLength(0);
    expect(chamadas.reservas).toHaveLength(0);
  });

  // A reconciliação revisita o mesmo pedido de hora em hora enquanto ele estiver na janela.
  it('aviso já dado não repete', async () => {
    const { chamadas, deps } = fakeDeps({ reservarNotificacao: () => Promise.resolve(false) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'cancelled' });
    expect(r).toBe('silenciado');
    expect(chamadas.notificacoes).toHaveLength(0);
  });
});

describe('tratarPedidoCancelado — guarda de status', () => {
  it('pedido que não está cancelado não faz nada', async () => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, statusPedido: 'paid', shipmentStatus: 'ready_to_ship' });
    expect(r).toBe('ignorado');
    expect(chamadas.estornos).toHaveLength(0);
    expect(chamadas.notificacoes).toHaveLength(0);
  });

  // A venda é sagrada: nenhum erro daqui pode derrubar o worker que a gravou.
  it('erro do estorno não propaga', async () => {
    const { deps } = fakeDeps({ estornarVendaCancelada: () => Promise.reject(new Error('rpc caiu')) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'ready_to_ship' });
    expect(r).toBe('erro');
  });
});
