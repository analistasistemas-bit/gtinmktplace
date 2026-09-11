import { describe, it, expect, vi, afterEach } from 'vitest';

// `sincronizarFaturamento` só precisa do access_token da sessão; o resto do client não é tocado.
vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

import { calcularKpis, fatiarJanela, marcaDagua, mesclarVendas, sincronizarFaturamento, type Venda } from '../faturamento';

const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 0, paid_amount: null, sale_fee_total: 0,
  frete_vendedor: null, liquido: null, estorno: null, money_release_date: null, sacado_em: null, sacado_por: null,
  atualizado_em: '2026-07-01T00:00:00Z',
  currency: 'BRL', shipping_id: null, shipping_status: null,
  shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  uf: null, cidade: null, itens: [], ...over,
});

describe('calcularKpis', () => {
  it('agrega faturamento, líquido, unidades, pedidos e ticket', () => {
    const k = calcularKpis([
      venda({ total_amount: 90.2, liquido: 83, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 2, unit_price: 45.1, sale_fee: 7.2, is_publiai: true }] }),
      venda({ total_amount: 10, liquido: 9, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 10, sale_fee: 1, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(100.2);
    expect(k.liquido).toBe(92);
    expect(k.unidades).toBe(3);
    expect(k.pedidos).toBe(2);
    expect(k.ticket).toBe(50.1);
  });
  it('ignora pedidos não pagos (cancelado) no faturamento', () => {
    const k = calcularKpis([
      venda({ status: 'paid', total_amount: 50, liquido: 45, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 50, sale_fee: 5, is_publiai: true }] }),
      venda({ status: 'cancelled', total_amount: 999, liquido: 900, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 9, unit_price: 111, sale_fee: 99, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(50);
    expect(k.pedidos).toBe(1);
    expect(k.unidades).toBe(1);
  });
  it('conta venda reembolsada (partially_refunded) no faturamento, igual ML', () => {
    const k = calcularKpis([
      venda({ status: 'paid', total_amount: 50, liquido: 45, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 50, sale_fee: 5, is_publiai: true }] }),
      venda({ status: 'partially_refunded', total_amount: 25, liquido: 9.58, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 2, unit_price: 12.5, sale_fee: 2, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(75);
    expect(k.pedidos).toBe(2);
    expect(k.unidades).toBe(3);
  });
  it('vazio → zeros e ticket 0', () => {
    expect(calcularKpis([])).toEqual({ faturamento: 0, liquido: 0, unidades: 0, pedidos: 0, ticket: 0, porStatusEnvio: {} });
  });
  it('conta TODOS os pedidos por status de envio (indep. de pagamento)', () => {
    const k = calcularKpis([
      venda({ status: 'paid', shipping_status: 'ready_to_ship' }),
      venda({ status: 'paid', shipping_status: 'ready_to_ship' }),
      venda({ status: 'paid', shipping_status: 'delivered' }),
      venda({ status: 'cancelled', shipping_status: 'shipped' }),
    ]);
    expect(k.porStatusEnvio).toEqual({ 'Pronto p/ envio': 2, 'Entregue': 1, 'Enviado': 1 });
  });
});

describe('marcaDagua', () => {
  it('vazio → null', () => {
    expect(marcaDagua([])).toBeNull();
  });
  it('parte do maior atualizado_em, recuado pela folga de 60s', () => {
    const max = marcaDagua([
      venda({ id: 'a', atualizado_em: '2026-07-01T10:00:00Z' }),
      venda({ id: 'b', atualizado_em: '2026-07-03T08:00:00Z' }),
      venda({ id: 'c', atualizado_em: '2026-07-02T12:00:00Z' }),
    ]);
    expect(max).toBe('2026-07-03T07:59:00.000Z');
  });
  // A folga existe porque `atualizado_em = now()` é o timestamp do INÍCIO da transação: uma
  // escrita que começou antes e commitou depois tem timestamp menor que outra já visível, e
  // sem a folga o delta a pularia para sempre — venda sumindo do Faturamento em silêncio.
  it('a folga cobre linha commitada fora de ordem dentro da mesma janela', () => {
    const marca = marcaDagua([venda({ id: 'b', atualizado_em: '2026-07-03T08:00:00Z' })])!;
    const atrasada = '2026-07-03T07:59:30Z'; // começou 30s antes, commitou depois
    expect(Date.parse(atrasada) >= Date.parse(marca)).toBe(true);
  });
  it('timestamp inválido não quebra o poll — devolve o valor cru', () => {
    expect(marcaDagua([venda({ id: 'a', atualizado_em: 'lixo' })])).toBe('lixo');
  });
});

describe('mesclarVendas', () => {
  it('delta vazio devolve a MESMA referência', () => {
    const atuais = [venda({ id: 'a' })];
    expect(mesclarVendas(atuais, [])).toBe(atuais);
  });
  it('substitui por id (ex.: status paid → cancelled)', () => {
    const atuais = [venda({ id: 'a', status: 'paid' })];
    const delta = [venda({ id: 'a', status: 'cancelled' })];
    const out = mesclarVendas(atuais, delta);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('cancelled');
  });
  it('insere venda nova e reordena por date_closed desc', () => {
    const atuais = [venda({ id: 'a', date_closed: '2026-07-01T00:00:00Z' })];
    const delta = [venda({ id: 'b', date_closed: '2026-07-05T00:00:00Z' })];
    const out = mesclarVendas(atuais, delta);
    expect(out.map((v) => v.id)).toEqual(['b', 'a']);
  });
  it('é idempotente: aplicar o mesmo delta duas vezes dá o mesmo resultado', () => {
    const atuais = [venda({ id: 'a', date_closed: '2026-07-01T00:00:00Z' })];
    const delta = [venda({ id: 'a', status: 'cancelled', date_closed: '2026-07-01T00:00:00Z' })];
    const uma = mesclarVendas(atuais, delta);
    const duas = mesclarVendas(uma, delta);
    expect(duas).toEqual(uma);
  });
  it('não perde vendas não tocadas pelo delta', () => {
    const atuais = [venda({ id: 'a' }), venda({ id: 'b' })];
    const delta = [venda({ id: 'a', status: 'cancelled' })];
    const out = mesclarVendas(atuais, delta);
    expect(out.map((v) => v.id).sort()).toEqual(['a', 'b']);
  });
});

describe('fatiarJanela', () => {
  const dia = (d: string) => `2026-08-${d}T00:00:00.000Z`;

  it('devolve uma fatia só quando a janela cabe no limite', () => {
    expect(fatiarJanela({ desde: dia('01'), ate: dia('05') })).toEqual([{ desde: dia('01'), ate: dia('05') }]);
  });

  it('quebra 30 dias em fatias de 7 sem furo nem sobreposição', () => {
    const fatias = fatiarJanela({ desde: dia('01'), ate: dia('31') });
    expect(fatias).toHaveLength(5); // 7+7+7+7+2
    expect(fatias[0].desde).toBe(dia('01'));
    for (let i = 1; i < fatias.length; i++) expect(fatias[i].desde).toBe(fatias[i - 1].ate);
  });

  it('nunca ultrapassa o `ate` pedido — senão traria pedidos fora do período exibido', () => {
    const fatias = fatiarJanela({ desde: dia('01'), ate: dia('31') });
    expect(fatias[fatias.length - 1].ate).toBe(dia('31'));
  });

  it('janela degenerada (desde >= ate) ainda rende uma fatia, não um no-op silencioso', () => {
    const j = { desde: dia('10'), ate: dia('10') };
    expect(fatiarJanela(j)).toEqual([j]);
  });

  it('respeita um tamanho de fatia customizado', () => {
    expect(fatiarJanela({ desde: dia('01'), ate: dia('07') }, 2)).toHaveLength(3);
  });
});

describe('sincronizarFaturamento', () => {
  const janela30 = { desde: '2026-08-01T00:00:00.000Z', ate: '2026-08-31T00:00:00.000Z' }; // 5 fatias
  const janela1 = { desde: '2026-08-01T00:00:00.000Z', ate: '2026-08-03T00:00:00.000Z' }; // 1 fatia

  const respostaOk = (n: number) => ({ ok: true, json: async () => ({ sincronizados: n }) });
  const resposta500 = { ok: false, status: 500, json: async () => ({ erro: 'timeout' }) };

  afterEach(() => { vi.unstubAllGlobals(); });

  it('uma fatia que falha não aborta as outras e não perde o que as demais trouxeram', async () => {
    let chamada = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++chamada === 2 ? resposta500 : respostaOk(3))));
    const r = await sincronizarFaturamento(janela30);
    expect(r).toEqual({ sincronizados: 12, falhas: 1, total: 5, incompletas: 0, semLiquido: 0 }); // 4 fatias × 3
  });

  it('janela de uma fatia só propaga o erro — senão o toast diria "0 pedidos" como se fosse sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta500));
    await expect(sincronizarFaturamento(janela1)).rejects.toThrow('timeout');
  });

  it('processa da fatia mais recente para a mais antiga', async () => {
    const enviados: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      enviados.push(JSON.parse(init.body).desde);
      return respostaOk(0);
    }));
    await sincronizarFaturamento(janela30);
    expect(enviados).toEqual([...enviados].sort().reverse());
  });

  it('soma as falhas que a função relata DENTRO de um 200 — 429 do ML não pode passar por sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ sincronizados: 0, conexoesComFalha: 1, pedidosComFalha: 2 }),
    })));
    const r = await sincronizarFaturamento(janela30);
    expect(r.sincronizados).toBe(0);
    expect(r.falhas).toBe(0); // nenhuma fatia caiu por HTTP
    expect(r.incompletas).toBe(15); // 5 fatias × (1 conexão + 2 pedidos)
  });

  it('período genuinamente vazio continua sendo sucesso limpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ sincronizados: 0, conexoesComFalha: 0, pedidosComFalha: 0, conexoesSemMP: 0 }),
    })));
    const r = await sincronizarFaturamento(janela30);
    expect(r).toEqual({ sincronizados: 0, falhas: 0, total: 5, incompletas: 0, semLiquido: 0 });
  });

  it('MP fora do ar conta em semLiquido, não em incompletas — a venda entrou, o valor não', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ sincronizados: 9, conexoesComFalha: 0, pedidosComFalha: 0, conexoesSemMP: 1 }),
    })));
    const r = await sincronizarFaturamento(janela30);
    expect(r.sincronizados).toBe(45);
    expect(r.incompletas).toBe(0);
    expect(r.semLiquido).toBe(5);
  });

  it('resposta antiga sem os campos novos não vira falso alarme', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sincronizados: 4 }) })));
    const r = await sincronizarFaturamento(janela30);
    expect(r.incompletas).toBe(0);
    expect(r.sincronizados).toBe(20);
  });

  it('só a primeira fatia paga perguntas/reclamações/mensagens — as demais vão com soVendas', async () => {
    const corpos: { soVendas?: boolean }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      corpos.push(JSON.parse(init.body));
      return respostaOk(0);
    }));
    await sincronizarFaturamento(janela30);
    expect(corpos).toHaveLength(5);
    expect(corpos[0].soVendas).toBeUndefined();
    expect(corpos.slice(1).every((c) => c.soVendas === true)).toBe(true);
  });

  it('janela de fatia única continua fazendo tudo — não existe "demais fatias" para poupar', async () => {
    const corpos: { soVendas?: boolean }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      corpos.push(JSON.parse(init.body));
      return respostaOk(1);
    }));
    await sincronizarFaturamento(janela1);
    expect(corpos).toEqual([expect.objectContaining({ desde: expect.any(String) })]);
    expect(corpos[0].soVendas).toBeUndefined();
  });

  it('reporta progresso concluído ao fim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaOk(1)));
    const progresso: [number, number][] = [];
    await sincronizarFaturamento(janela30, (f, t) => progresso.push([f, t]));
    expect(progresso[progresso.length - 1]).toEqual([5, 5]);
  });
});
