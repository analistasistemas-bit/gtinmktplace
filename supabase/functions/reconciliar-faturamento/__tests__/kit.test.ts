import { describe, it, expect } from 'vitest';
import { desfechoKit, processarClaim, type IoClaim } from '../kit.ts';
import { tratarPedidoCancelado, type DepsCancelamento, type PedidoCancelado, type ResultadoCancelamento } from '../../_shared/estoque/cancelamento.ts';

// ADR-0200 (Task 8, rodada 2): o crédito de kit entra no desfecho do claim. Sem crédito nem obrigação gravada
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

// Emenda 8 ao ADR-0121: envio `cancelled` que pode ter a prova também entra no crédito de kit.
describe('processarClaim: envio cancelado que pode nunca ter saído', () => {
  const CANDIDATO = { shipmentStatus: 'cancelled', shipmentSubstatus: null, lerNuncaSaiu: () => Promise.resolve('sim' as const) };

  it('com prova e crédito `repetir` (tratamento real): lança e NUNCA grava a devolução', async () => {
    const { x, ordem } = io({ kitLigado: true, resultado: 'erro', pedido: CANDIDATO });
    let estornos = 0;
    const deps = {
      baixasAbertas: () => Promise.resolve({ abertas: [{ codigoRef: 'KIT', codigo: 'KIT', quantidade: 1 }], haEstornada: false }),
      notificacaoJaEnviada: () => Promise.resolve(false), saldoMexidoDepois: () => Promise.resolve(false),
      classificarItensKit: (_a: unknown, p: { itens: unknown[] }) => Promise.resolve({ certos: p.itens, incertos: [], divergentes: [] }),
      gravarIdentidades: (_a: unknown, p: { itens: unknown[] }) => Promise.resolve(p.itens),
      skusParticipantes: () => Promise.resolve(new Set(['KIT'])),
      estornarVendaCancelada: () => { estornos++; return Promise.resolve({ pendentesDePush: [], falhas: [{ codigo: 'KIT', mensagem: 'x' }], aplicados: [] }); },
      despacharPushPendente: () => Promise.resolve({ marcados: 0, falhas: 0 }),
      registrarPendenciaKit: () => Promise.reject(new Error('banco')),
    } as unknown as DepsCancelamento;
    x.tratar = (p) => tratarPedidoCancelado({} as never, deps, p);
    await expect(processarClaim(x)).rejects.toThrow('obrigação de crédito não gravada');
    expect(estornos).toBe(1);
    expect(ordem).not.toContain('devolucao');
  });

  it.each(['reposto', 'pendente', 'adiado', 'silenciado', 'sem-baixa'] as const)('%s: trata e depois grava a devolução', async (resultado) => {
    const { x, ordem } = io({ kitLigado: true, resultado, pedido: CANDIDATO });
    await processarClaim(x);
    expect(ordem).toEqual(['resolver', 'pedido', 'cancelamento', 'devolucao']);
  });

  it('sem prova: a devolução é gravada antes do aviso (que lê o motivo dela), uma vez só', async () => {
    const { x, ordem } = io({ kitLigado: true, resultado: 'avisado', pedido: CANDIDATO });
    x.tratar = async (p) => { await p.antesDoAviso?.(); ordem.push('aviso'); return 'avisado'; };
    await processarClaim(x);
    expect(ordem).toEqual(['resolver', 'pedido', 'devolucao', 'aviso']);
  });

  it('substatus ou sem thunk: ordem de hoje', async () => {
    for (const pedido of [{ ...CANDIDATO, shipmentSubstatus: 'pack_splitted' }, { ...CANDIDATO, lerNuncaSaiu: undefined }]) {
      const { x, ordem } = io({ kitLigado: true, resultado: 'avisado', pedido });
      await processarClaim(x);
      expect(ordem).toEqual(['resolver', 'pedido', 'devolucao', 'cancelamento']);
    }
  });
});

describe('desfechoKit', () => {
  it('adiado é sucesso: o dono é a fila do ADR-0211', () => {
    expect(desfechoKit({ mpLido: true, cancelamento: 'adiado', baixaOk: true })).toBe(true);
  });
  it('repetir lança; pendente e baixa adiada não são sucesso', () => {
    expect(() => desfechoKit({ mpLido: true, cancelamento: 'repetir', baixaOk: true })).toThrow();
    expect(desfechoKit({ mpLido: true, cancelamento: 'pendente', baixaOk: true })).toBe(false);
    expect(desfechoKit({ mpLido: true, cancelamento: 'ignorado', baixaOk: false })).toBe(false);
    expect(desfechoKit({ mpLido: false, cancelamento: 'reposto', baixaOk: true })).toBe(false);
    expect(desfechoKit({ mpLido: true, cancelamento: 'ignorado', baixaOk: true })).toBe(true);
  });
});
