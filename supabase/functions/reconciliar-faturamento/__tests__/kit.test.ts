import { describe, it, expect } from 'vitest';
import { desfechoKit, processarClaim, type IoClaim } from '../kit.ts';
import type { PedidoCancelado, ResultadoCancelamento } from '../../_shared/estoque/cancelamento.ts';

// ADR-0199 (Task 8, rodada 2): o crédito de kit entra no desfecho do claim. Sem crédito nem obrigação gravada
// (`repetir`), a devolução não é gravada (o claim continua no filtro) e o claim conta como falha.
const PRE: PedidoCancelado = {
  orgId: 'o', userId: null, canal: 'mercado_livre', orderId: 1, itens: [], statusPedido: 'cancelled',
  shipmentStatus: 'ready_to_ship', temEnvio: true, kitLigado: true,
};

function io(o: { kitLigado: boolean; resultado: ResultadoCancelamento; pedido?: Partial<PedidoCancelado> }) {
  const ordem: string[] = [];
  const x: IoClaim = {
    kitLigado: o.kitLigado,
    resolverPedido: () => { ordem.push('resolver'); return Promise.resolve({ ignorado: false, orderId: 1 }); },
    gravarDevolucao: () => { ordem.push('devolucao'); return Promise.resolve({ ignorado: false, orderId: 1 }); },
    prepararPedido: () => { ordem.push('pedido'); return Promise.resolve({ ...PRE, kitLigado: o.kitLigado, ...o.pedido }); },
    tratar: () => { ordem.push('cancelamento'); return Promise.resolve(o.resultado); },
  };
  return { x, ordem };
}

describe('processarClaim', () => {
  it('módulo + crédito de kit + repetir: lança sem gravar a devolução', async () => {
    const { x, ordem } = io({ kitLigado: true, resultado: 'repetir' });
    await expect(processarClaim(x)).rejects.toThrow('obrigação de crédito não gravada');
    expect(ordem).toEqual(['resolver', 'pedido', 'cancelamento']);
  });

  it('módulo + crédito pendente (obrigação gravada): grava a devolução depois', async () => {
    const { x, ordem } = io({ kitLigado: true, resultado: 'pendente' });
    await processarClaim(x);
    expect(ordem).toEqual(['resolver', 'pedido', 'cancelamento', 'devolucao']);
  });

  it('módulo, pós-despacho: devolução antes (o aviso lê o cancel_purchase dela)', async () => {
    const { x, ordem } = io({ kitLigado: true, resultado: 'avisado', pedido: { shipmentStatus: 'shipped' } });
    await processarClaim(x);
    expect(ordem).toEqual(['resolver', 'pedido', 'devolucao', 'cancelamento']);
  });

  it('sem módulo: ordem de hoje, sem resolver o pedido antes', async () => {
    const { x, ordem } = io({ kitLigado: false, resultado: 'reposto' });
    await processarClaim(x);
    expect(ordem).toEqual(['devolucao', 'pedido', 'cancelamento']);
  });
});

describe('desfechoKit', () => {
  it('repetir lança; pendente e baixa adiada não são sucesso', () => {
    expect(() => desfechoKit({ mpLido: true, cancelamento: 'repetir', baixaOk: true })).toThrow();
    expect(desfechoKit({ mpLido: true, cancelamento: 'pendente', baixaOk: true })).toBe(false);
    expect(desfechoKit({ mpLido: true, cancelamento: 'ignorado', baixaOk: false })).toBe(false);
    expect(desfechoKit({ mpLido: false, cancelamento: 'reposto', baixaOk: true })).toBe(false);
    expect(desfechoKit({ mpLido: true, cancelamento: 'ignorado', baixaOk: true })).toBe(true);
  });
});
