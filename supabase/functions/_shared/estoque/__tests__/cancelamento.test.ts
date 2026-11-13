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
      return Promise.resolve({
        pendentesDePush: [{ id: 'm1', codigoPai: 'P1', canalOrigem: null, reposicao: true, skuRestrito: null }],
        falhas: [], aplicados: [],
      });
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
    cancelamentoPeloComprador: () => Promise.resolve(false),
    reservarNotificacao: (_admin, _org, _user, entidade, chave) => {
      chamadas.reservas.push({ entidade, chave });
      return Promise.resolve(true);
    },
    notificarCategoria: (_admin, _org, categoria, texto) => {
      chamadas.notificacoes.push({ categoria, texto });
      return Promise.resolve();
    },
    // Org sem módulo nunca chega aqui; lançar prova que nada de kit é consultado.
    skusParticipantes: () => Promise.reject(new Error('consulta de kit inesperada')),
    agendarCancelamentoKit: () => Promise.reject(new Error('agendamento de kit inesperado')),
    classificarItensKit: () => Promise.reject(new Error('identidade inesperada')),
    gravarIdentidades: () => Promise.reject(new Error('identidade inesperada')),
    registrarPendenciaKit: () => Promise.reject(new Error('pendência inesperada')),
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

  // Emenda ADR-0121 (03/11/2026): claim cancel_purchase, fechado pelo ML em ~3 min. O texto não
  // pode mandar "conferir o que voltou" nem afirmar que a mercadoria ficou, mas mantém a entrada manual.
  it('cancel_purchase usa texto próprio e NÃO estorna', async () => {
    const { chamadas, deps } = fakeDeps({ cancelamentoPeloComprador: () => Promise.resolve(true) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'cancelled' });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
    expect(chamadas.notificacoes).toHaveLength(1);
    expect(chamadas.notificacoes[0].texto).toContain(`Comprador cancelou o pedido ${BASE.orderId}`);
    expect(chamadas.notificacoes[0].texto).toContain('entrada manual em Estoque');
    expect(chamadas.notificacoes[0].texto).not.toContain('Se o produto estiver aí');
  });

  it('falha ao ler o claim cai no texto genérico e não cala o aviso', async () => {
    const { chamadas, deps } = fakeDeps({ cancelamentoPeloComprador: () => Promise.reject(new Error('rede')) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'cancelled' });
    expect(r).toBe('avisado');
    expect(chamadas.notificacoes[0].texto).toContain('Não dá para saber se a mercadoria saiu');
    expect(chamadas.notificacoes[0].texto).toContain('Se o produto estiver aí');
  });

  it('envio entregue avisa e NÃO estorna', async () => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'delivered' });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
    const t = chamadas.notificacoes[0].texto;
    expect(t).toContain('estoque NÃO reposto');
    expect(t).toContain('Envio: Entregue');
    expect(t).toContain('A mercadoria já saiu');
    expect(t).toContain('Quando o produto voltar');
    expect(t).toContain(`/vendas/${BASE.orderId}/detalhe`);
  });

  // buscarShipment devolve null em QUALQUER erro de rede — tratar null como "não despachado"
  // reporia mercadoria que saiu (falha fechada, ADR-0094 D-7).
  it('shipment ilegível avisa que não pôde ser consultado', async () => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: null });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
    expect(chamadas.notificacoes[0].texto).toContain('Envio: não deu para consultar');
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

// ADR-0200 (Task 8): SKU participante de kit com variação. Só com o módulo ligado; o resto segue como hoje.
describe('tratarPedidoCancelado — kit com variação', () => {
  const KIT = { ...BASE, itens: [{ codigo: 'KIT-PB-M', quantity: 1 }], shipmentStatus: 'ready_to_ship', kitLigado: true };
  const PENDENTES = [
    { id: 'est-kit', codigoPai: 'KIT', canalOrigem: null, reposicao: true, skuRestrito: null },
    { id: 'outro', codigoPai: 'OUTRO', canalOrigem: null, reposicao: true, skuRestrito: null },
  ];

  function depsKit(over: Partial<DepsCancelamento> = {}) {
    const extra = {
      participantes: [] as string[][],
      agendados: [] as string[][],
      pendencias: [] as Array<{ orderId: string; erro: string }>,
      despachados: [] as string[][],
    };
    const { chamadas, deps } = fakeDeps({
      estornarVendaCancelada: (_a, p) => {
        chamadas.estornos.push({ orderId: p.orderId, itens: p.itens });
        return Promise.resolve({ pendentesDePush: PENDENTES, falhas: [], aplicados: ['KIT-PB-M'] });
      },
      despacharPushPendente: (_a, _o, pendentes) => {
        extra.despachados.push(pendentes.map((m) => m.id));
        return Promise.resolve({ marcados: pendentes.length, falhas: 0 });
      },
      skusParticipantes: (_a, _o, skus) => {
        extra.participantes.push(skus);
        return Promise.resolve(new Set(skus.filter((s) => s.startsWith('KIT-'))));
      },
      agendarCancelamentoKit: (_a, p) => {
        extra.agendados.push(p.codigos);
        return Promise.resolve(['est-kit']);
      },
      // Leitura incerta: só '00000029' é comum comprovado (vínculo sem participante); o resto fica incerto.
      gravarIdentidades: (_a, p) => Promise.resolve(p.itens),
      classificarItensKit: (_a, p) => Promise.resolve(p.incerto
        ? { certos: p.itens.filter((i) => i.codigo === '00000029'), incertos: p.itens.filter((i) => i.codigo !== '00000029'), divergentes: [] }
        : { certos: p.itens, incertos: [], divergentes: [] }),
      registrarPendenciaKit: (_a, _o, orderId, erro) => {
        extra.pendencias.push({ orderId, erro });
        return Promise.resolve();
      },
      ...over,
    });
    return { chamadas, deps, extra };
  }

  it('pré-despacho credita e agenda a transferência; o estorno agendado sai do push', async () => {
    const { chamadas, deps, extra } = depsKit();
    const r = await tratarPedidoCancelado(ADMIN, deps, KIT);
    expect(r).toBe('reposto');
    expect(chamadas.estornos).toHaveLength(1);
    expect(extra.agendados).toEqual([['KIT-PB-M']]);
    expect(extra.despachados).toEqual([['outro']]);
    expect(extra.pendencias).toEqual([]);
  });

  it('retry com o crédito já feito (duplicata) não cria outra transferência', async () => {
    const { deps, extra } = depsKit({
      estornarVendaCancelada: () => Promise.resolve({ pendentesDePush: [], falhas: [], aplicados: [] }),
    });
    expect(await tratarPedidoCancelado(ADMIN, deps, KIT)).toBe('reposto');
    expect(extra.agendados).toEqual([]);
  });

  it('pós-despacho não credita nem agenda', async () => {
    const { chamadas, deps, extra } = depsKit();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...KIT, shipmentStatus: 'shipped' });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
    expect(extra.agendados).toEqual([]);
  });

  it('falha de crédito do participante fica pendente com retry durável', async () => {
    const { chamadas, deps, extra } = depsKit({
      estornarVendaCancelada: () => Promise.resolve({
        pendentesDePush: PENDENTES, falhas: [{ codigo: 'KIT-PB-M', mensagem: 'canonica_trocou' }], aplicados: [],
      }),
    });
    const r = await tratarPedidoCancelado(ADMIN, deps, KIT);
    expect(r).toBe('pendente');
    expect(extra.pendencias).toEqual([{ orderId: String(BASE.orderId), erro: expect.stringContaining('canonica_trocou') }]);
    expect(chamadas.reservas).toContainEqual({ entidade: 'estoque_cancelado_kit_pendente', chave: String(BASE.orderId) });
    expect(chamadas.notificacoes[0].categoria).toBe('estoque');
    // O que já está no outbox segue para o push.
    expect(extra.despachados).toEqual([['est-kit', 'outro']]);
  });

  it('estorno que lança com participante no pedido também fica pendente', async () => {
    const { deps, extra } = depsKit({ estornarVendaCancelada: () => Promise.reject(new Error('rede')) });
    expect(await tratarPedidoCancelado(ADMIN, deps, KIT)).toBe('pendente');
    expect(extra.pendencias).toHaveLength(1);
  });

  it('participantes ilegíveis: pendente, sem estornar às cegas', async () => {
    const { chamadas, deps, extra } = depsKit({ skusParticipantes: () => Promise.reject(new Error('timeout')) });
    expect(await tratarPedidoCancelado(ADMIN, deps, KIT)).toBe('pendente');
    expect(chamadas.estornos).toHaveLength(0);
    expect(extra.pendencias).toHaveLength(1);
    // Causa transitória: pendência calada.
    expect(chamadas.reservas).toEqual([]);
    expect(chamadas.notificacoes).toEqual([]);
  });

  it('catálogo incompleto com o módulo ligado: participante incerto pendente, sem estorno dele', async () => {
    const { chamadas, deps, extra } = depsKit();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...KIT, catalogoIncompleto: true });
    expect(r).toBe('pendente');
    expect(chamadas.estornos[0].itens).toEqual([]);
    expect(extra.pendencias).toHaveLength(1);
    expect(chamadas.reservas).toEqual([]);
    expect(chamadas.notificacoes).toEqual([]);
  });

  it('SKU retirado segue creditável: credita, sem transferência e sem pendência', async () => {
    const { chamadas, deps, extra } = depsKit({ agendarCancelamentoKit: () => Promise.resolve([]) });
    const r = await tratarPedidoCancelado(ADMIN, deps, KIT);
    expect(r).toBe('reposto');
    expect(chamadas.estornos).toHaveLength(1);
    expect(extra.despachados).toEqual([['est-kit', 'outro']]);
    expect(extra.pendencias).toEqual([]);
  });

  it('agendamento que falha não desfaz o crédito: o outbox leva o estorno', async () => {
    const { deps, extra } = depsKit({ agendarCancelamentoKit: () => Promise.reject(new Error('rpc')) });
    expect(await tratarPedidoCancelado(ADMIN, deps, KIT)).toBe('reposto');
    expect(extra.despachados).toEqual([['est-kit', 'outro']]);
  });

  it('SKU comum com o módulo ligado: falha segue como hoje (reposto), sem pendência', async () => {
    const { deps, extra } = depsKit({
      estornarVendaCancelada: () => Promise.resolve({
        pendentesDePush: [], falhas: [{ codigo: '00000029', mensagem: 'x' }], aplicados: [],
      }),
    });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...KIT, itens: [{ codigo: '00000029', quantity: 1 }] });
    expect(r).toBe('reposto');
    expect(extra.pendencias).toEqual([]);
    expect(extra.agendados).toEqual([]);
  });

  it('pedido misto com leitura incerta: credita o comum já, só o participante fica pendente', async () => {
    const { chamadas, deps, extra } = depsKit();
    const COMUM = { codigo: '00000029', quantity: 1 };
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...KIT, itens: [COMUM, ...KIT.itens], catalogoIncompleto: true });
    expect(r).toBe('pendente');
    expect(chamadas.estornos[0].itens).toEqual([COMUM]);
    expect(extra.pendencias).toHaveLength(1);
  });

  it('pedido só comum com leitura incerta: comportamento de hoje (reposto, sem pendência)', async () => {
    const { chamadas, deps, extra } = depsKit({
      estornarVendaCancelada: (_a, p) => {
        chamadas.estornos.push({ orderId: p.orderId, itens: p.itens });
        return Promise.resolve({ pendentesDePush: [], falhas: [], aplicados: ['00000029'] });
      },
    });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...KIT, itens: [{ codigo: '00000029', quantity: 1 }], catalogoIncompleto: true });
    expect(r).toBe('reposto');
    expect(chamadas.estornos).toHaveLength(1);
    expect(extra.pendencias).toEqual([]);
  });

  it('estorna pelo SKU da identidade da baixa, não pelo resolvido agora', async () => {
    const { chamadas, deps } = depsKit({
      classificarItensKit: (_a, p) => Promise.resolve({ certos: p.itens.map((i) => ({ ...i, codigo: 'KIT-ORIGINAL' })), incertos: [], divergentes: [] }),
    });
    await tratarPedidoCancelado(ADMIN, deps, KIT);
    expect(chamadas.estornos[0].itens).toEqual([{ codigo: 'KIT-ORIGINAL', quantity: 1 }]);
  });

  it('o cancelamento grava a identidade e estorna pelo SKU vencedor', async () => {
    const gravadas: string[][] = [];
    const { chamadas, deps } = depsKit({
      gravarIdentidades: (_a, p) => {
        gravadas.push(p.itens.map((i) => i.codigo ?? ''));
        return Promise.resolve(p.itens.map((i) => ({ ...i, codigo: 'KIT-PRIMEIRO' })));
      },
    });
    await tratarPedidoCancelado(ADMIN, deps, KIT);
    expect(gravadas).toEqual([['KIT-PB-M']]);
    expect(chamadas.estornos[0].itens).toEqual([{ codigo: 'KIT-PRIMEIRO', quantity: 1 }]);
  });

  it('identidade ilegível: pendente calado, sem estorno', async () => {
    const { chamadas, deps, extra } = depsKit({ classificarItensKit: () => Promise.reject(new Error('fora')) });
    expect(await tratarPedidoCancelado(ADMIN, deps, KIT)).toBe('pendente');
    expect(chamadas.estornos).toHaveLength(0);
    expect(extra.pendencias).toHaveLength(1);
    expect(chamadas.notificacoes).toEqual([]);
  });

  it('obrigação não gravada: repetir (o chamador não pode reconhecer)', async () => {
    const { deps } = depsKit({
      estornarVendaCancelada: () => Promise.resolve({
        pendentesDePush: [], falhas: [{ codigo: 'KIT-PB-M', mensagem: 'x' }], aplicados: [],
      }),
      registrarPendenciaKit: () => Promise.reject(new Error('banco fora')),
    });
    expect(await tratarPedidoCancelado(ADMIN, deps, KIT)).toBe('repetir');
  });

  it('org sem módulo: nenhuma consulta de kit, falha segue como hoje', async () => {
    const { deps, extra } = depsKit({
      estornarVendaCancelada: () => Promise.resolve({
        pendentesDePush: PENDENTES, falhas: [{ codigo: 'KIT-PB-M', mensagem: 'x' }], aplicados: ['KIT-PB-M'],
      }),
    });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...KIT, kitLigado: false, catalogoIncompleto: true });
    expect(r).toBe('reposto');
    expect(extra.participantes).toEqual([]);
    expect(extra.agendados).toEqual([]);
    expect(extra.pendencias).toEqual([]);
    expect(extra.despachados).toEqual([['est-kit', 'outro']]);
  });
});
