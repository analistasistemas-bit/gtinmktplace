import { afterEach, describe, it, expect, vi } from 'vitest';
import { entraNoCreditoKit, envioParaTratamento, tratarPedidoCancelado, type DepsCancelamento, type PedidoCancelado } from '../cancelamento';
import { baixasAbertas, type ProvaNuncaSaiu } from '../nunca-saiu';

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
    claimDoPedido: () => Promise.resolve(null),
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
    // Emenda 8: sem o thunk nada disto é lido.
    baixasAbertas: () => Promise.reject(new Error('ledger inesperado')),
    saldoMexidoDepois: () => Promise.reject(new Error('trava inesperada')),
    notificacaoJaEnviada: () => Promise.reject(new Error('dedupe inesperado')),
    filaAssume: () => Promise.reject(new Error('fila inesperada')),
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
    const { chamadas, deps } = fakeDeps({ claimDoPedido: () => Promise.resolve({ tipo: 'cancel_purchase', motivo: 'Outro motivo', desfecho: null }) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'cancelled' });
    expect(r).toBe('avisado');
    expect(chamadas.estornos).toHaveLength(0);
    expect(chamadas.notificacoes).toHaveLength(1);
    expect(chamadas.notificacoes[0].texto).toContain(`Comprador cancelou o pedido ${BASE.orderId}`);
    expect(chamadas.notificacoes[0].texto).toContain('entrada manual em Estoque');
    expect(chamadas.notificacoes[0].texto).not.toContain('Se o produto estiver aí');
  });

  it('falha ao ler o claim cai no texto genérico e não cala o aviso', async () => {
    const { chamadas, deps } = fakeDeps({ claimDoPedido: () => Promise.reject(new Error('rede')) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'cancelled' });
    expect(r).toBe('avisado');
    expect(chamadas.notificacoes[0].texto).toContain('Não dá para saber se a mercadoria saiu');
    expect(chamadas.notificacoes[0].texto).toContain('Se o produto estiver aí');
  });

  // Caso real 2000019297158586 (13/11/2026): entregue, mediação "defeito ou diferente" fechada com cobertura.
  it('mediação aparece como motivo e desfecho no aviso', async () => {
    const { chamadas, deps } = fakeDeps({ claimDoPedido: () => Promise.resolve({
      tipo: 'mediations', motivo: 'Produto com defeito ou diferente', desfecho: 'Mediação finalizada. Te demos o dinheiro.',
    }) });
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'delivered' });
    expect(r).toBe('avisado');
    const t = chamadas.notificacoes[0].texto;
    expect(t).toContain('Motivo: Mediação — Produto com defeito ou diferente');
    expect(t).toContain('Desfecho: Mediação finalizada. Te demos o dinheiro.');
    expect(t).toContain('A mercadoria já saiu');
  });

  it('sem claim não inventa motivo', async () => {
    const { chamadas, deps } = fakeDeps();
    await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'delivered' });
    expect(chamadas.notificacoes[0].texto).not.toContain('Motivo:');
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

// Emenda 24/11/2026 ao ADR-0121 (decisão 3): `ready_to_ship` só é pré-despacho com substatus de preparo. Com o
// pacote já retirado/despachado (picked_up, dropped_off, in_hub…) ou com substatus desconhecido, só avisa.
describe('tratarPedidoCancelado — ready_to_ship pelo substatus', () => {
  it.each(['ready_to_print', 'printed', 'invoice_pending', null])('substatus de preparo "%s" repõe', async (sub) => {
    const { chamadas, deps } = fakeDeps();
    const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'ready_to_ship', shipmentSubstatus: sub });
    expect(r).toBe('reposto');
    expect(chamadas.estornos).toHaveLength(1);
  });

  it.each(['picked_up', 'dropped_off', 'in_hub', 'in_packing_list', 'in_warehouse', 'xyz_desconhecido'])(
    'substatus "%s" avisa sem repor', async (sub) => {
      const { chamadas, deps } = fakeDeps();
      const r = await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'ready_to_ship', shipmentSubstatus: sub });
      expect(r).toBe('avisado');
      expect(chamadas.estornos).toHaveLength(0);
    });

  it('substatus não muda pending/handling (fora do ready_to_ship)', async () => {
    const { deps } = fakeDeps();
    expect(await tratarPedidoCancelado(ADMIN, deps, { ...BASE, shipmentStatus: 'pending', shipmentSubstatus: 'buffered' })).toBe('reposto');
  });

  it('crédito de kit segue a mesma regra', () => {
    const k = { ...BASE, shipmentStatus: 'ready_to_ship', kitLigado: true };
    expect(entraNoCreditoKit({ ...k, shipmentSubstatus: 'printed' })).toBe(true);
    expect(entraNoCreditoKit({ ...k, shipmentSubstatus: 'picked_up' })).toBe(false);
  });

  it('envioParaTratamento leva status e substatus do shipment lido', () => {
    expect(envioParaTratamento({ status: 'ready_to_ship', substatus: 'picked_up' })).toEqual({ shipmentStatus: 'ready_to_ship', shipmentSubstatus: 'picked_up' });
    expect(envioParaTratamento({ status: 'shipped', substatus: null })).toEqual({ shipmentStatus: 'shipped', shipmentSubstatus: null });
    expect(envioParaTratamento(null)).toEqual({ shipmentStatus: null, shipmentSubstatus: null });
  });
});

// Emenda 8 (24/11/2026) ao ADR-0121: envio `cancelled` sem substatus e nunca impresso repõe.
describe('tratarPedidoCancelado: envio cancelado que nunca saiu', () => {
  interface L { codigoRef: string; codigo: string; quantidade: number; estornada: boolean; some?: boolean }
  const b = (codigoRef: string, quantidade = 1, codigo = codigoRef): L => ({ codigoRef, codigo, quantidade, estornada: false });
  const est = (codigoRef: string, quantidade = 1): L => ({ ...b(codigoRef, quantidade), estornada: true });

  /** Ledger vivo: o estorno marca a baixa; `some` = variação apagada (a RPC não credita e a baixa segue aberta). */
  function cenario(o: {
    ledger?: L[]; prova?: ProvaNuncaSaiu; mexido?: boolean; avisado?: boolean; assume?: boolean;
    deps?: Partial<DepsCancelamento>; pedido?: Partial<PedidoCancelado>;
  } = {}) {
    const ledger = o.ledger ?? [b('00000029')];
    const lido = { prova: 0, ledger: 0, saldo: 0, dedupe: 0, fila: 0 };
    const { chamadas, deps } = fakeDeps({
      estornarVendaCancelada: (_a, p) => {
        chamadas.estornos.push({ orderId: p.orderId, itens: p.itens });
        const aplicados: string[] = [];
        for (const i of p.itens) {
          const l = ledger.find((x) => x.codigoRef === i.codigo && !x.estornada && !x.some);
          if (l) { l.estornada = true; aplicados.push(l.codigoRef); }
        }
        return Promise.resolve({ pendentesDePush: [], falhas: [], aplicados });
      },
      baixasAbertas: () => {
        lido.ledger++;
        return Promise.resolve({
          abertas: ledger.filter((l) => !l.estornada).map(({ codigoRef, codigo, quantidade }) => ({ codigoRef, codigo, quantidade })),
          haEstornada: ledger.some((l) => l.estornada),
        });
      },
      saldoMexidoDepois: () => { lido.saldo++; return Promise.resolve(!!o.mexido); },
      notificacaoJaEnviada: (_a, _o, entidade, chave) => {
        lido.dedupe++;
        return Promise.resolve(!!o.avisado && entidade === 'estoque_cancelado_despachado' && chave === String(BASE.orderId));
      },
      filaAssume: () => { lido.fila++; return Promise.resolve(!!o.assume); },
      // Catálogo atual: o SKU resolvido não tem baixa. No ramo novo isto não decide nada.
      houveBaixaDeVenda: () => Promise.resolve(false),
      ...o.deps,
    });
    const pedido: PedidoCancelado = {
      ...BASE, itens: [{ codigo: 'SKU-TROCADO', quantity: 9 }], shipmentStatus: 'cancelled', shipmentSubstatus: null,
      lerNuncaSaiu: () => { lido.prova++; return Promise.resolve(o.prova ?? 'sim'); },
      ...o.pedido,
    };
    return { chamadas, deps, lido, ledger, rodar: () => tratarPedidoCancelado(ADMIN, deps, pedido) };
  }

  it('com a prova repõe os SKUs abertos do ledger, despacha o push, relê o ledger e não avisa', async () => {
    const c = cenario({ ledger: [b('00000029', 2), b('ABC:01'), est('OUTRO')] });
    expect(await c.rodar()).toBe('reposto');
    expect(c.chamadas.estornos).toEqual([{ orderId: BASE.orderId, itens: [{ codigo: '00000029', quantity: 2 }, { codigo: 'ABC:01', quantity: 1 }] }]);
    expect(c.chamadas.despachos).toBe(1);
    expect(c.chamadas.reservas).toEqual([]);
    expect(c.lido).toMatchObject({ prova: 1, ledger: 2, saldo: 1 });
  });

  it('impressa (sem prova) avisa o texto de hoje, mesmo com o SKU do catálogo trocado', async () => {
    const c = cenario({ prova: 'nao' });
    expect(await c.rodar()).toBe('avisado');
    expect(c.chamadas.estornos).toEqual([]);
    expect(c.chamadas.reservas).toEqual([{ entidade: 'estoque_cancelado_despachado', chave: String(BASE.orderId) }]);
    const hoje = fakeDeps();
    await tratarPedidoCancelado(ADMIN, hoje.deps, { ...BASE, shipmentStatus: 'cancelled' });
    expect(c.chamadas.notificacoes).toEqual(hoje.chamadas.notificacoes);
  });

  it.each([
    ['substatus', { shipmentSubstatus: 'pack_splitted' }], ['entregue', { shipmentStatus: 'delivered' }],
    ['envio não lido', { shipmentStatus: null }],
  ])('%s: não lê o histórico nem repõe, aviso de hoje', async (_n, pedido) => {
    const c = cenario({ pedido, deps: { houveBaixaDeVenda: () => Promise.resolve(true) } });
    expect(await c.rodar()).toBe('avisado');
    expect(c.lido).toMatchObject({ prova: 0, saldo: 0, dedupe: 0, fila: 0 });
    expect(c.chamadas.estornos).toEqual([]);
  });

  it('pedido sem envio segue o pré-despacho de hoje, sem ler nada novo', async () => {
    const c = cenario({ pedido: { temEnvio: false } });
    expect(await c.rodar()).toBe('reposto');
    expect(c.lido).toEqual({ prova: 0, ledger: 0, saldo: 0, dedupe: 0, fila: 0 });
  });

  it('sem o thunk: igual à main (avisa, sem ler nada novo)', async () => {
    const c = cenario({ pedido: { lerNuncaSaiu: undefined }, deps: { houveBaixaDeVenda: () => Promise.resolve(true) } });
    expect(await c.rodar()).toBe('avisado');
    expect(c.lido).toEqual({ prova: 0, ledger: 0, saldo: 0, dedupe: 0, fila: 0 });
  });

  it('já avisado silencia sem ler o histórico nem reservar', async () => {
    const c = cenario({ avisado: true });
    expect(await c.rodar()).toBe('silenciado');
    expect(c.lido.prova).toBe(0);
    expect(c.chamadas.estornos).toEqual([]);
    expect(c.chamadas.reservas).toEqual([]);
  });

  it.each([['tudo estornado', [est('00000029')]], ['sem baixa', []]])('%s: sem-baixa, sem histórico nem aviso falso', async (_n, ledger) => {
    const c = cenario({ ledger, deps: { houveBaixaDeVenda: () => Promise.resolve(true) } });
    expect(await c.rodar()).toBe('sem-baixa');
    expect(c.lido.prova).toBe(0);
    expect(c.chamadas.notificacoes).toEqual([]);
  });

  it('saldo mexido depois da baixa: avisa sem repor', async () => {
    const c = cenario({ mexido: true });
    expect(await c.rodar()).toBe('avisado');
    expect(c.lido.saldo).toBe(1);
    expect(c.chamadas.estornos).toEqual([]);
  });

  describe('indisponível', () => {
    const falha = () => Promise.reject(new Error('fora'));
    const casos: Array<[string, Parameters<typeof cenario>[0]]> = [
      ['histórico indisponível', { prova: 'indisponivel' }],
      ['histórico que lança', { pedido: { lerNuncaSaiu: falha } }],
      ['dedupe não lido', { deps: { notificacaoJaEnviada: falha } }],
      ['trava não lida', { deps: { saldoMexidoDepois: falha } }],
    ];
    it.each(casos)('%s e a fila assume: adiado, sem repor nem reservar', async (_n, o) => {
      const c = cenario({ ...o, assume: true });
      expect(await c.rodar()).toBe('adiado');
      expect(c.chamadas.estornos).toEqual([]);
      expect(c.chamadas.reservas).toEqual([]);
    });
    it.each(casos)('%s e a fila não assume: avisa agora, sem repor', async (_n, o) => {
      const c = cenario(o);
      expect(await c.rodar()).toBe('avisado');
      expect(c.lido.fila).toBe(1);
      expect(c.chamadas.estornos).toEqual([]);
    });
    it('RPC do ledger não lida: a fila assume → adiado; senão, só aí o caminho antigo (houveBaixaDeVenda) decide', async () => {
      expect(await cenario({ assume: true, deps: { baixasAbertas: falha } }).rodar()).toBe('adiado');
      for (const [houve, esperado] of [[true, 'avisado'], [false, 'sem-baixa']] as const) {
        const c = cenario({ deps: { baixasAbertas: falha, houveBaixaDeVenda: () => Promise.resolve(houve) } });
        expect(await c.rodar()).toBe(esperado);
      }
    });
    it('RPC confirmou baixa aberta e só a leitura do movimento falhou: avisa, sem passar por houveBaixaDeVenda', async () => {
      const q = { select: () => q, eq: () => q, lt: () => q, like: () => Promise.resolve({ data: null, error: { message: 'fora' } }) };
      const rpc = () => Promise.resolve({ data: [{ codigo_ref: '00000029', quantidade: 1, estornada: false }], error: null });
      for (const o of [{ prova: 'nao' }, { prova: 'indisponivel' }] as const) {
        const c = cenario({ ...o, deps: { baixasAbertas } });
        const r = await tratarPedidoCancelado({ from: () => q, rpc } as never, c.deps, {
          ...BASE, itens: [{ codigo: 'SKU-TROCADO', quantity: 9 }], shipmentStatus: 'cancelled', lerNuncaSaiu: () => Promise.resolve(o.prova),
        });
        expect(r).toBe('avisado');
        expect(c.chamadas.notificacoes[0].texto).toContain('estoque NÃO reposto');
      }
    });
    it('não deu para saber se a fila assume: avisa agora', async () => {
      let consultas = 0;
      const c = cenario({ prova: 'indisponivel', deps: { filaAssume: () => { consultas++; return falha(); } } });
      expect(await c.rodar()).toBe('avisado');
      expect(consultas).toBe(1);
    });
    it('a política da fila (p.aoIndisponivel) vale no lugar da consulta', async () => {
      const c = cenario({ prova: 'indisponivel', assume: true, pedido: { aoIndisponivel: () => 'erro' } });
      expect(await c.rodar()).toBe('erro');
      const d = cenario({ prova: 'indisponivel', assume: true, pedido: { aoIndisponivel: () => 'avisar' } });
      expect(await d.rodar()).toBe('avisado');
      expect(c.lido.fila + d.lido.fila).toBe(0);
      expect(c.chamadas.reservas).toEqual([]);
    });
  });

  describe('estorno que deixa baixa aberta (variação apagada: a RPC responde duplicata para sempre)', () => {
    const ledger = () => [b('00000029'), { ...b('APAGADO', 3), some: true }];
    it('a fila não assume: avisa só o que ficou aberto', async () => {
      const c = cenario({ ledger: ledger() });
      expect(await c.rodar()).toBe('avisado');
      const t = c.chamadas.notificacoes[0].texto;
      expect(t).toContain('já voltou');
      expect(t).toContain('APAGADO — 3 un.');
      expect(t).not.toContain('00000029');
    });
    it('a fila assume: adiado; na fila: pendente', async () => {
      expect(await cenario({ ledger: ledger(), assume: true }).rodar()).toBe('adiado');
      expect(await cenario({ ledger: ledger(), pedido: { aoIndisponivel: () => 'erro' } }).rodar()).toBe('erro');
    });
    it('estorno que lança: o ledger decide (aberta → avisa; creditada → reposto)', async () => {
      const c = cenario({ deps: { estornarVendaCancelada: () => Promise.reject(new Error('rpc')) } });
      expect(await c.rodar()).toBe('avisado');
      const d = cenario({ deps: { despacharPushPendente: () => Promise.reject(new Error('fila de push')) } });
      expect(await d.rodar()).toBe('reposto');
      expect(d.chamadas.notificacoes).toEqual([]);
    });
    describe('releitura do ledger falhou: o estorno pode ter entrado', () => {
      const semReleitura = (o: Parameters<typeof cenario>[0] = {}) => {
        let n = 0;
        return cenario({ ...o, deps: { ...o.deps, baixasAbertas: () => (n++ === 0
          ? Promise.resolve({ abertas: [b('00000029')], haEstornada: false }) : Promise.reject(new Error('fora'))) } });
      };
      it('a fila assume: adiado; na fila, pendente; sem reservar aviso', async () => {
        const c = semReleitura({ assume: true });
        expect(await c.rodar()).toBe('adiado');
        const d = semReleitura({ pedido: { aoIndisponivel: () => 'erro' } });
        expect(await d.rodar()).toBe('erro');
        expect([...c.chamadas.reservas, ...d.chamadas.reservas]).toEqual([]);
      });
      it.each([['webhook', {}], ['fila na 3ª', { pedido: { aoIndisponivel: () => 'avisar' as const } }]])(
        '%s: avisa com texto neutro, nunca "NÃO reposto" nem "dê entrada manual"', async (_n, o) => {
          const c = semReleitura(o);
          expect(await c.rodar()).toBe('avisado');
          expect(c.chamadas.reservas).toEqual([{ entidade: 'estoque_cancelado_despachado', chave: String(BASE.orderId) }]);
          const t = c.chamadas.notificacoes[0].texto;
          expect(t).toContain('O estoque pode ter voltado em parte');
          expect(t).toContain('antes de dar entrada');
          expect(t).not.toContain('NÃO');
          expect(t).not.toContain('dê entrada manual');
        });
      it('cancel_purchase: mesmo texto neutro', async () => {
        const c = semReleitura({ deps: { claimDoPedido: () => Promise.resolve({ tipo: 'cancel_purchase', motivo: null, desfecho: null }) } });
        expect(await c.rodar()).toBe('avisado');
        const t = c.chamadas.notificacoes[0].texto;
        expect(t).toContain('Comprador cancelou');
        expect(t).toContain('O estoque pode ter voltado em parte');
        expect(t).not.toContain('NÃO');
      });
    });
  });

  describe('aviso em estado parcial', () => {
    it('sem prova: só SKU e quantidade abertos, do movimento (base do kit vinculado), somados por SKU', async () => {
      const c = cenario({ prova: 'nao', ledger: [est('VOLTOU', 4), b('KIT', 6, 'BASE'), b('BASE', 1), b('A', 2)] });
      expect(await c.rodar()).toBe('avisado');
      expect(c.chamadas.reservas).toEqual([{ entidade: 'estoque_cancelado_despachado', chave: String(BASE.orderId) }]);
      const { categoria, texto } = c.chamadas.notificacoes[0];
      expect(categoria).toBe('pos_venda');
      expect(texto).toContain('• BASE — 7 un.\n• A — 2 un.');
      expect(texto).toContain('já voltou');
      expect(texto).not.toContain('VOLTOU');
      expect(texto).not.toContain('KIT');
      expect(texto).not.toContain('estoque NÃO reposto');
    });
    it('cancel_purchase também lista só o aberto', async () => {
      const c = cenario({ prova: 'nao', ledger: [est('VOLTOU'), b('A', 2)],
        deps: { claimDoPedido: () => Promise.resolve({ tipo: 'cancel_purchase', motivo: null, desfecho: null }) } });
      expect(await c.rodar()).toBe('avisado');
      const t = c.chamadas.notificacoes[0].texto;
      expect(t).toContain(`Comprador cancelou o pedido ${BASE.orderId}`);
      expect(t).toContain('• A — 2 un.');
      expect(t).not.toContain('O estoque NÃO foi reposto');
    });
    it('vale fora do ramo novo (envio despachado), e a falha do ledger cai no texto de hoje', async () => {
      const casa = { pedido: { shipmentStatus: 'shipped' }, ledger: [est('VOLTOU'), b('A', 2)] };
      const baixa = { houveBaixaDeVenda: () => Promise.resolve(true) };
      const c = cenario({ ...casa, deps: baixa });
      expect(await c.rodar()).toBe('avisado');
      expect(c.chamadas.notificacoes[0].texto).toContain('• A — 2 un.');
      const d = cenario({ ...casa, deps: { ...baixa, baixasAbertas: () => Promise.reject(new Error('fora')) } });
      expect(await d.rodar()).toBe('avisado');
      expect(d.chamadas.notificacoes[0].texto).toContain('estoque NÃO reposto');
    });
  });

  it('parcial sem o código do movimento: texto neutro, nunca o SKU da referência', async () => {
    const c = cenario({ prova: 'nao', deps: { baixasAbertas: () => Promise.resolve({ abertas: [{ codigoRef: 'KIT', codigo: null, quantidade: 2 }], haEstornada: true }) } });
    expect(await c.rodar()).toBe('avisado');
    const t = c.chamadas.notificacoes[0].texto;
    expect(t).toContain('O estoque pode ter voltado em parte');
    expect(t).not.toContain('KIT');
  });

  describe('a leitura do texto parcial não consome o aviso', () => {
    afterEach(() => { vi.useRealTimers(); });
    const DESPACHADO = { pedido: { shipmentStatus: 'shipped' } };
    it('lê o ledger antes de reservar', async () => {
      const ordem: string[] = [];
      const c = cenario({ ...DESPACHADO, deps: {
        houveBaixaDeVenda: () => Promise.resolve(true),
        baixasAbertas: () => { ordem.push('ledger'); return Promise.resolve({ abertas: [], haEstornada: false }); },
        reservarNotificacao: () => { ordem.push('reserva'); return Promise.resolve(true); },
      } });
      expect(await c.rodar()).toBe('avisado');
      expect(ordem).toEqual(['ledger', 'reserva']);
    });
    it('outra execução já estornou tudo: sem-baixa, sem aviso nem reserva', async () => {
      const c = cenario({ ...DESPACHADO, deps: {
        houveBaixaDeVenda: () => Promise.resolve(true),
        baixasAbertas: () => Promise.resolve({ abertas: [], haEstornada: true }),
      } });
      expect(await c.rodar()).toBe('sem-baixa');
      expect(c.chamadas.reservas).toEqual([]);
      expect(c.chamadas.notificacoes).toEqual([]);
    });
    it('ramo novo: outra execução estorna tudo enquanto o histórico falha: relê e não avisa', async () => {
      const c = cenario({ pedido: {
        aoIndisponivel: () => 'avisar',
        lerNuncaSaiu: () => { for (const l of c.ledger) l.estornada = true; return Promise.resolve('indisponivel' as const); },
      } });
      expect(await c.rodar()).toBe('sem-baixa');
      expect(c.chamadas.reservas).toEqual([]);
      expect(c.chamadas.notificacoes).toEqual([]);
    });
    it('ramo novo: estornada só uma parte enquanto isso: o aviso lista só o que segue aberto', async () => {
      const c = cenario({ ledger: [b('00000029'), b('00000030')], pedido: {
        aoIndisponivel: () => 'avisar',
        lerNuncaSaiu: () => { c.ledger[0].estornada = true; return Promise.resolve('indisponivel' as const); },
      } });
      expect(await c.rodar()).toBe('avisado');
      expect(c.chamadas.notificacoes[0].texto).toContain('00000030');
      expect(c.chamadas.notificacoes[0].texto).not.toContain('00000029');
    });
    it('ramo novo: releitura falha → avisa com a leitura anterior', async () => {
      let n = 0;
      const c = cenario({ prova: 'nao', deps: { baixasAbertas: () => n++ === 0
        ? Promise.resolve({ abertas: [{ codigoRef: 'A', codigo: 'A', quantidade: 1 }], haEstornada: false }) : Promise.reject(new Error('fora')) } });
      expect(await c.rodar()).toBe('avisado');
      expect(n).toBe(2);
    });
    it('parcial já conhecido por quem chama e releitura falha: texto neutro, nunca "NÃO reposto"', async () => {
      const c = cenario({ pedido: { shipmentStatus: 'shipped', parcialConhecido: true }, deps: {
        houveBaixaDeVenda: () => Promise.resolve(true), baixasAbertas: () => Promise.reject(new Error('fora')),
      } });
      expect(await c.rodar()).toBe('avisado');
      expect(c.chamadas.notificacoes[0].texto).toContain('Confira o saldo em Estoque antes de dar entrada');
      expect(c.chamadas.notificacoes[0].texto).not.toContain('NÃO reposto');
    });
    it('leitura pendurada: em 3 s segue com o texto padrão', async () => {
      vi.useFakeTimers();
      const c = cenario({ ...DESPACHADO, deps: { houveBaixaDeVenda: () => Promise.resolve(true), baixasAbertas: () => new Promise(() => {}) } });
      let r: string | null = null;
      c.rodar().then((x) => { r = x; });
      await vi.advanceTimersByTimeAsync(2_900);
      expect(c.chamadas.reservas).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(r).toBe('avisado');
      expect(c.chamadas.notificacoes[0].texto).toContain('estoque NÃO reposto');
    });
  });

  it('antesDoAviso roda antes de reservar o aviso; com erro nele, nada é reservado', async () => {
    const ordem: string[] = [];
    const c = cenario({ prova: 'nao', pedido: { antesDoAviso: () => { ordem.push('antes'); return Promise.resolve(); } },
      deps: { reservarNotificacao: () => { ordem.push('reserva'); return Promise.resolve(true); } } });
    await c.rodar();
    expect(ordem).toEqual(['antes', 'reserva']);
    const d = cenario({ prova: 'nao', pedido: { antesDoAviso: () => Promise.reject(new Error('x')) } });
    expect(await d.rodar()).toBe('erro');
    expect(d.chamadas.reservas).toEqual([]);
  });

  describe('kit com variação', () => {
    const kit = (over: Partial<DepsCancelamento> = {}) => {
      const agendados: string[][] = [];
      const incertos: boolean[] = [];
      const c = cenario({
        ledger: [b('KIT-PB-M')], pedido: { kitLigado: true, catalogoIncompleto: true },
        deps: {
          classificarItensKit: (_a, p) => {
            incertos.push(p.incerto);
            return Promise.resolve(p.incerto ? { certos: [], incertos: p.itens, divergentes: [] } : { certos: p.itens, incertos: [], divergentes: [] });
          },
          gravarIdentidades: (_a, p) => Promise.resolve(p.itens),
          skusParticipantes: (_a, _o, skus) => Promise.resolve(new Set(skus)),
          agendarCancelamentoKit: (_a, p) => { agendados.push(p.codigos); return Promise.resolve([]); },
          registrarPendenciaKit: () => Promise.resolve(),
          ...over,
        },
      });
      return { ...c, agendados, incertos };
    };
    it('credita e agenda a transferência com o SKU do ledger, mesmo com o catálogo incompleto', async () => {
      const c = kit();
      expect(await c.rodar()).toBe('reposto');
      expect(c.agendados).toEqual([['KIT-PB-M']]);
      expect(c.incertos).toEqual([false]);
    });
    const semCredito = () => Promise.resolve({ pendentesDePush: [], falhas: [{ codigo: 'KIT-PB-M', mensagem: 'x' }], aplicados: [] });
    it('pendente preserva a retentativa e não manda dar entrada', async () => {
      const c = kit({ estornarVendaCancelada: semCredito });
      expect(await c.rodar()).toBe('pendente');
      expect(c.chamadas.reservas.map((r) => r.entidade)).toEqual(['estoque_cancelado_kit_pendente']);
    });
    it('repetir passa direto, sem aviso de entrada', async () => {
      const c = kit({ estornarVendaCancelada: semCredito, registrarPendenciaKit: () => Promise.reject(new Error('banco')) });
      expect(await c.rodar()).toBe('repetir');
      expect(c.chamadas.reservas).toEqual([]);
    });
  });
});
