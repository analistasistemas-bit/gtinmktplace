import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { agregarPorSku, montarVendasSku } from '@/lib/vendas-sku';
import { serieDoSku, vinculoDoMlb, montarEventos, perguntasPorIntervalo, ufsDoSku, mixDaFamilia, situacaoCampanhas, montarDossie } from '@/lib/sku-dossie';
import type { Movimento, Moderacao } from '@/lib/sku-dossie-dados';
import type { Devolucao } from '@/lib/devolucoes';
import type { CatalogoSku } from '@/lib/vendas-sku-catalogo';
import { intervalosBRT } from '@/lib/calendario-brt';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver } from '@/lib/resumo-vendas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: '001', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over };
}
function venda(over: Partial<Venda> = {}): Venda {
  return { id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-10T12:00:00Z', date_created: null, comprador_nick: 'c', comprador_id: 100,
    total_amount: 10, paid_amount: 10, sale_fee_total: 1, frete_vendedor: null, liquido: 9, estorno: null,
    money_release_date: null, currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over };
}

const custo: CustoResolver = () => 4; // R$ 4 por unidade (custo atual → estimado)
const agrupar = (vs: Venda[]) => agruparPorPedido(vs, custo);
// Semanas BRT de 14/09 e 21/09 (segundas, 03:00Z).
const IVS = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-27T02:59:59.999Z', 'semana', new Date('2026-10-01T12:00:00Z'));
// Dias do Ads (até ontem) nos testes que não tratam dele.
const J_ADS = { desde: '2026-09-16T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' };
const S1 = { desde: '2026-09-14T03:00:00.000Z', ate: '2026-09-21T02:59:59.999Z' };

describe('serieDoSku — cupom do vendedor (ADR-0180)', () => {
  // Revisão Codex: média descontava o cupom e mínimo/máximo não → média abaixo do mínimo.
  it('média, mínimo e máximo na mesma base (preço sem o cupom)', () => {
    const vendas = [venda({ id: 'a', date_closed: '2026-09-15T12:00:00Z', total_amount: 66.4, cupom_vendedor: 2.5, liquido: 37.93,
      itens: [item({ codigo: 'A', unit_price: 66.4, cupom_vendedor: 2.5 })] })];
    const [s1] = serieDoSku({ vendas, agrupar, codigos: ['A'], intervalos: IVS, catalogo: new Map(), ordensDevolvidas: new Set() });
    expect(s1).toMatchObject({ bruto: 63.9, precoMedio: 63.9, precoMin: 63.9, precoMax: 63.9 });
  });
});

describe('serieDoSku', () => {
  it('série: bate com agregarPorSku no mesmo intervalo; preço médio ponderado; intervalo sem venda sem preço', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-15T12:00:00Z', total_amount: 20, liquido: 18,
        itens: [item({ id: 'i1', codigo: 'A', quantity: 2, unit_price: 10 })] }),
      // domingo 23:59 BRT → ainda semana 1 (fim meio-aberto)
      venda({ id: 'b', order_id: 2, date_closed: '2026-09-21T02:59:00Z', total_amount: 13, liquido: 12,
        itens: [item({ id: 'i2', codigo: 'A', quantity: 1, unit_price: 13 })] }),
      // outro SKU na semana 1 — fora da série
      venda({ id: 'c', order_id: 3, date_closed: '2026-09-16T12:00:00Z', total_amount: 50, liquido: 45,
        itens: [item({ id: 'i3', codigo: 'B', quantity: 1, unit_price: 50 })] }),
      // domingo 23:59 BRT da semana anterior — fora de todos os intervalos
      venda({ id: 'd', order_id: 4, date_closed: '2026-09-14T02:59:00Z', total_amount: 99, liquido: 90,
        itens: [item({ id: 'i4', codigo: 'A', quantity: 9, unit_price: 11 })] }),
    ];
    const serie = serieDoSku({ vendas, agrupar, codigos: ['A'], intervalos: IVS, catalogo: new Map(), ordensDevolvidas: new Set() });
    expect(serie).toHaveLength(2);
    const [s1, s2] = serie;
    expect(s1.intervalo).toBe(IVS[0]);
    // bruto 2×10 + 13 = 33; lucro (18 − 8) + (12 − 4) = 18; preço 33 ÷ 3 = 11
    expect(s1).toMatchObject({ unidades: 3, bruto: 33, lucro: 18, fonteCusto: 'estimado', precoMedio: 11, precoMin: 10, precoMax: 13 });
    // oráculo: agregarPorSku da Fatia 1 no mesmo recorte
    const oraculo = agregarPorSku(agrupar(vendas.slice(0, 2)), S1, new Map(), new Set());
    expect(oraculo).toHaveLength(1);
    expect(s1.bruto).toBe(oraculo[0].acc.bruto);
    expect(s1.lucro).toBe(oraculo[0].m.lucro);
    expect(s2).toMatchObject({ unidades: 0, bruto: 0, lucro: null, precoMedio: null, precoMin: null, precoMax: null });
  });

  it('pack com o SKU e outro produto: o SKU recebe só a fatia dele (frete rateado igual à aba Vendas)', () => {
    // Pack 9, mesmo envio, frete R$ 10 rateado por valor (sem peso): A 30/50 → 6, B 20/50 → 4.
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 9, shipping_id: 77, frete_vendedor: 10, date_closed: '2026-09-15T12:00:00Z',
        total_amount: 30, sale_fee_total: 3, itens: [item({ id: 'i1', codigo: 'A', quantity: 3, unit_price: 10 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 9, shipping_id: 77, frete_vendedor: 10, date_closed: '2026-09-15T12:00:00Z',
        total_amount: 20, sale_fee_total: 2, itens: [item({ id: 'i2', codigo: 'B', quantity: 1, unit_price: 20 })] }),
    ];
    const [s1] = serieDoSku({ vendas, agrupar, codigos: ['A'], intervalos: IVS, catalogo: new Map(), ordensDevolvidas: new Set() });
    // líquido A = 30 − 3 − 6 = 21; custo 3 × 4 = 12; lucro 9
    expect(s1).toMatchObject({ unidades: 3, bruto: 30, lucro: 9, precoMedio: 10, precoMin: 10, precoMax: 10 });
    const oraculo = agregarPorSku(agrupar(vendas), S1, new Map(), new Set()).find((l) => l.codigo === 'A')!;
    expect(oraculo.acc.liquido).toBe(21);
    expect(s1.lucro).toBe(oraculo.m.lucro);
  });
});

describe('serieDoSku: pedidos e kit por intervalo', () => {
  it('cada ponto traz os pedidos do intervalo que contêm o SKU e as unidades vendidas dentro de kit', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-15T12:00:00Z', itens: [item({ id: 'i1', codigo: 'A', quantity: 2 })] }),
      venda({ id: 'k', order_id: 2, kit_item_id: 'KIT1', date_closed: '2026-09-16T12:00:00Z', itens: [item({ id: 'i2', codigo: 'A', quantity: 3 })] }),
      // kit cancelado: não faturável, fora das unidades de kit
      venda({ id: 'kc', order_id: 5, kit_item_id: 'KIT1', status: 'cancelled', date_closed: '2026-09-16T13:00:00Z', itens: [item({ id: 'i5', codigo: 'A', quantity: 4 })] }),
      venda({ id: 'b', order_id: 3, date_closed: '2026-09-16T12:00:00Z', itens: [item({ id: 'i3', codigo: 'B' })] }),
      venda({ id: 'c', order_id: 4, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i4', codigo: 'A' })] }),
    ];
    const [s1, s2] = serieDoSku({ vendas, agrupar, codigos: ['A'], intervalos: IVS, catalogo: new Map(), ordensDevolvidas: new Set() });
    expect(s1.pedidos.map((p) => p.orderIds[0]).sort()).toEqual([1, 2, 5]);
    expect(s1.unidades).toBe(5);
    expect(s1.unidadesKit).toBe(3);
    expect(s2.pedidos.map((p) => p.orderIds[0])).toEqual([4]);
    expect(s2.unidadesKit).toBe(0);
  });
});

describe('montarDossie: kitVirtual', () => {
  const cat: CatalogoSku = {
    codigo: 'A', codigoPai: null, nomeFamilia: null, nome: 'FITA A', cor: null, tamanho: null, estoque: 5, fornecedor: null,
    origem: 'nacional', ehKit: false, primeiraVenda: '2026-09-01T12:00:00Z', ultimaVenda: '2026-09-22T12:00:00Z',
    kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null,
  };
  const base = (vendas: Venda[]) => montarDossie({
    alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], vendas, agrupar, catalogo: [cat], devolucoes: [],
    // Período começa na quarta 16/09: a 1ª semana do gráfico (desde segunda 14/09) vai além dele.
    janela: { desde: '2026-09-16T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
    anterior: { desde: '2026-09-05T03:00:00.000Z', ate: '2026-09-16T02:59:59.999Z' },
    hoje: { desde: '2026-08-28T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
    hojeAnterior: { desde: '2026-07-29T03:00:00.000Z', ate: '2026-08-28T02:59:59.999Z' },
    intervalos: IVS, janelaAds: J_ADS, mlbs: new Map(), movimentos: [], moderacoes: [], perguntas: [], campanhas: [],
  });

  it('unidades dentro de kit no período (corte da janela) e por intervalo (corte do intervalo)', () => {
    const { dados } = base([
      // segunda 15/09: dentro da 1ª semana, fora do período
      venda({ id: 'k0', order_id: 1, kit_item_id: 'KIT1', date_closed: '2026-09-15T12:00:00Z', itens: [item({ id: 'i1', codigo: 'A', quantity: 2 })] }),
      venda({ id: 'k1', order_id: 2, kit_item_id: 'KIT1', date_closed: '2026-09-17T12:00:00Z', itens: [item({ id: 'i2', codigo: 'A', quantity: 3 })] }),
      venda({ id: 'k2', order_id: 3, kit_item_id: 'KIT1', date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i3', codigo: 'A', quantity: 1 })] }),
      venda({ id: 'n', order_id: 4, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i4', codigo: 'A', quantity: 7 })] }),
    ]);
    expect(dados?.kitVirtual).toEqual({ unidadesPeriodo: 4, unidadesPorIntervalo: [5, 1] });
  });

  it('sem venda dentro de kit → null', () => {
    const { dados } = base([venda({ id: 'n', order_id: 4, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i4', codigo: 'A' })] })]);
    expect(dados?.kitVirtual).toBeNull();
  });
});

describe('montarDossie: lucroAds (mesmos dias do Ads, até ontem)', () => {
  const cat: CatalogoSku = {
    codigo: 'A', codigoPai: null, nomeFamilia: null, nome: 'FITA A', cor: null, tamanho: null, estoque: 5, fornecedor: null,
    origem: 'nacional', ehKit: false, primeiraVenda: '2026-09-01T12:00:00Z', ultimaVenda: '2026-09-27T15:00:00Z',
    kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null,
  };
  const ontem = venda({ id: 'o', order_id: 1, date_closed: '2026-09-26T15:00:00Z', itens: [item({ id: 'i1', codigo: 'A', quantity: 1, unit_price: 30 })] });
  const hoje = venda({ id: 'h', order_id: 2, date_closed: '2026-09-27T15:00:00Z', itens: [item({ id: 'i2', codigo: 'A', quantity: 2, unit_price: 50 })] });
  const monta = (vendas: Venda[], janelaAds: { desde: string; ate: string } | null = { desde: '2026-09-25T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' }) => montarDossie({
    alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], vendas, agrupar, catalogo: [cat], devolucoes: [],
    janela: { desde: '2026-09-25T03:00:00.000Z', ate: '2026-09-28T02:59:59.999Z' }, // 25/09 a hoje (27/09)
    anterior: { desde: '2026-09-22T03:00:00.000Z', ate: '2026-09-25T02:59:59.999Z' },
    hoje: { desde: '2026-08-29T03:00:00.000Z', ate: '2026-09-28T02:59:59.999Z' },
    hojeAnterior: { desde: '2026-07-30T03:00:00.000Z', ate: '2026-08-29T02:59:59.999Z' },
    intervalos: IVS, janelaAds, mlbs: new Map(), movimentos: [], moderacoes: [], perguntas: [], campanhas: [],
  }).dados!;

  it('venda de hoje fica fora do lucroAds; linhaPeriodo continua com as duas', () => {
    const d = monta([ontem, hoje]);
    const soOntem = monta([ontem]);
    expect(d.linhaPeriodo!.acc.unidades).toBe(3);
    expect(d.lucroAds).not.toBeNull();
    expect(d.lucroAds!.lucro).toBeCloseTo(soOntem.linhaPeriodo!.m.lucro!, 2);
    expect(d.lucroAds!.lucro).not.toBeCloseTo(d.linhaPeriodo!.m.lucro!, 2);
    expect(d.lucroAds!.fonteCusto).toBe(soOntem.linhaPeriodo!.m.fonteCusto);
  });

  it('sem venda nos dias do Ads (só hoje) → lucro 0 real, não null (null esconderia o prejuízo do Ads)', () => {
    expect(monta([hoje]).lucroAds).toEqual({ lucro: 0, fonteCusto: 'real' });
  });

  it('sem dia financeiro (janelaAds null) → lucroAds null', () => {
    expect(monta([ontem, hoje], null).lucroAds).toBeNull();
  });
});

describe('montarDossie: estoque com kit', () => {
  const cat = (codigo: string, over: Partial<CatalogoSku> = {}): CatalogoSku => ({
    codigo, codigoPai: 'P', nomeFamilia: 'Fam', nome: codigo, cor: null, tamanho: null, estoque: 10, fornecedor: null,
    origem: 'nacional', ehKit: false, primeiraVenda: '2026-09-01T12:00:00Z', ultimaVenda: '2026-09-22T12:00:00Z',
    kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null, ...over,
  });
  const kit = (codigo: string) => cat(codigo, { ehKit: true, estoque: 0, kitMultiplicador: 2, kitBaseCodigo: 'A', estoqueKit: 4 });
  const monta = (alvo: { tipo: 'sku'; codigo: string } | { tipo: 'familia'; codigoPai: string }, codigos: string[], catalogo: CatalogoSku[]) => montarDossie({
    alvo, codigos, agrupar, catalogo, devolucoes: [],
    vendas: [venda({ id: 'n', order_id: 4, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i4', codigo: 'A', quantity: 3 })] })],
    janela: { desde: '2026-09-16T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
    anterior: { desde: '2026-09-05T03:00:00.000Z', ate: '2026-09-16T02:59:59.999Z' },
    hoje: { desde: '2026-08-28T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
    hojeAnterior: { desde: '2026-07-29T03:00:00.000Z', ate: '2026-08-28T02:59:59.999Z' },
    intervalos: IVS, janelaAds: J_ADS, mlbs: new Map(), movimentos: [], moderacoes: [], perguntas: [], campanhas: [],
  }).dados!;

  it('família com irmã kit: saldo só das unidades não-kit e cobertura em dias (não soma kits com unidades)', () => {
    const d = monta({ tipo: 'familia', codigoPai: 'P' }, ['A', 'K'], [cat('A'), kit('K')]);
    expect(d.estoque).toBe(10);
    expect(typeof d.cobertura).toBe('number');
  });

  it('família mista: a cobertura usa só o ritmo das variações comuns (kits vendidos ficam fora do u30)', () => {
    const d = montarDossie({
      alvo: { tipo: 'familia', codigoPai: 'P' }, codigos: ['A', 'K'], agrupar, catalogo: [cat('A'), kit('K')], devolucoes: [],
      vendas: [
        venda({ id: 'n', order_id: 4, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i4', codigo: 'A', quantity: 3 })] }),
        venda({ id: 'k', order_id: 5, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i5', codigo: 'K', quantity: 3 })] }),
      ],
      janela: { desde: '2026-09-16T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
      anterior: { desde: '2026-09-05T03:00:00.000Z', ate: '2026-09-16T02:59:59.999Z' },
      hoje: { desde: '2026-08-28T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
      hojeAnterior: { desde: '2026-07-29T03:00:00.000Z', ate: '2026-08-28T02:59:59.999Z' },
      intervalos: IVS, janelaAds: J_ADS, mlbs: new Map(), movimentos: [], moderacoes: [], perguntas: [], campanhas: [],
    }).dados!;
    // 10 un. ÷ (3 un. de A em 30 dias) = 100 dias; contando os 3 kits daria 50
    expect(d.cobertura).toBe(100);
  });

  it('eventos de estoque: só os da base de um kit (fora do alvo) levam estoqueDaBase', () => {
    const d = montarDossie({
      alvo: { tipo: 'familia', codigoPai: 'P' }, codigos: ['A', 'K'], agrupar, devolucoes: [],
      catalogo: [cat('A'), { ...kit('K'), kitBaseCodigo: 'X' }],
      vendas: [venda({ id: 'n', order_id: 4, date_closed: '2026-09-22T12:00:00Z', itens: [item({ id: 'i4', codigo: 'A', quantity: 3 })] })],
      janela: { desde: '2026-09-16T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
      anterior: { desde: '2026-09-05T03:00:00.000Z', ate: '2026-09-16T02:59:59.999Z' },
      hoje: { desde: '2026-08-28T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
      hojeAnterior: { desde: '2026-07-29T03:00:00.000Z', ate: '2026-08-28T02:59:59.999Z' },
      intervalos: IVS, janelaAds: J_ADS, mlbs: new Map(), moderacoes: [], perguntas: [], campanhas: [],
      movimentos: [
        mov({ id: 'ma', codigo: 'A', estoque_anterior: 2, estoque_resultante: 0 }),
        mov({ id: 'mx', codigo: 'X', estoque_anterior: 3, estoque_resultante: 0, criado_em: '2026-09-11T12:00:00Z' }),
      ],
    }).dados!;
    expect(d.eventos.map((e) => [e.id, e.estoqueDaBase ?? false])).toEqual([['ma:ruptura', false], ['mx:ruptura', true]]);
  });

  it('só kits: saldo floor(base/N) e cobertura compartilhada', () => {
    const d = monta({ tipo: 'sku', codigo: 'K' }, ['K'], [kit('K')]);
    expect(d.estoque).toBe(4);
    expect(d.cobertura).toBe('compartilhado');
  });
});

describe('montarDossie: chave da família (familia:<pai>) — paridade de dinheiro com o ranking', () => {
  const cat = (codigo: string): CatalogoSku => ({
    codigo, codigoPai: 'P', nomeFamilia: 'Fam', nome: codigo, cor: null, tamanho: null, estoque: 10, fornecedor: null,
    origem: 'nacional', ehKit: false, primeiraVenda: '2026-09-01T12:00:00Z', ultimaVenda: '2026-09-22T12:00:00Z',
    kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null,
  });
  const janela = { desde: '2026-09-16T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' };
  const anterior = { desde: '2026-09-05T03:00:00.000Z', ate: '2026-09-16T02:59:59.999Z' };
  const quando = '2026-09-20T12:00:00Z';
  // Pack 900: order 11 (A×2), order 12 (A + B — duas irmãs na MESMA order), order 13 (Z, outro produto).
  // Fora do pack: order 20 (C). Taxas por item para o rateio do pack não ser trivial.
  const vendas = [
    venda({ id: 'p11', order_id: 11, pack_id: 900, date_closed: quando, total_amount: 40, sale_fee_total: 5, liquido: 35,
      itens: [item({ id: 'i11', codigo: 'A', quantity: 2, unit_price: 20, sale_fee: 2.5 })] }),
    venda({ id: 'p12', order_id: 12, pack_id: 900, date_closed: quando, total_amount: 50, sale_fee_total: 6, liquido: 44,
      itens: [item({ id: 'i12a', codigo: 'A', quantity: 1, unit_price: 20, sale_fee: 2 }), item({ id: 'i12b', codigo: 'B', quantity: 1, unit_price: 30, sale_fee: 4 })] }),
    venda({ id: 'p13', order_id: 13, pack_id: 900, date_closed: quando, total_amount: 45, sale_fee_total: 4.5, liquido: 40.5,
      itens: [item({ id: 'i13', codigo: 'Z', quantity: 3, unit_price: 15, sale_fee: 1.5 })] }),
    venda({ id: 'o20', order_id: 20, date_closed: quando, total_amount: 25, sale_fee_total: 3, liquido: 22,
      itens: [item({ id: 'i20', codigo: 'C', quantity: 1, unit_price: 25, sale_fee: 3 })] }),
  ];
  const catalogo = [cat('A'), cat('B'), cat('C')];

  it('lucro e bruto = soma das linhas por código; pedidos contam orders (não linhas)', () => {
    const d = montarDossie({
      alvo: { tipo: 'familia', codigoPai: 'P' }, codigos: ['A', 'B', 'C'], vendas, agrupar, catalogo, devolucoes: [],
      janela, anterior,
      hoje: { desde: '2026-08-28T03:00:00.000Z', ate: '2026-09-27T02:59:59.999Z' },
      hojeAnterior: { desde: '2026-07-29T03:00:00.000Z', ate: '2026-08-28T02:59:59.999Z' },
      intervalos: IVS, janelaAds: J_ADS, mlbs: new Map(), movimentos: [], moderacoes: [], perguntas: [], campanhas: [],
    }).dados!;
    const ranking = montarVendasSku({ vendas, agrupar, janela, anterior, catalogo: new Map(catalogo.map((c) => [c.codigo, c])), devolucoes: [] });
    const irmas = ranking.linhas.filter((l) => ['A', 'B', 'C'].includes(l.codigo));
    expect(irmas).toHaveLength(3);
    const soma = (f: (l: (typeof irmas)[number]) => number) => Math.round(irmas.reduce((t, l) => t + f(l), 0) * 100) / 100;

    const linha = d.linhaPeriodo!;
    expect(linha.codigo).toBe('familia:P');
    expect(linha.m.lucro).toBeCloseTo(soma((l) => l.m.lucro ?? NaN), 2);
    expect(linha.acc.bruto).toBeCloseTo(soma((l) => l.acc.bruto), 2);
    // Z (outro produto do pack) fica fora: bruto das irmãs = 40 + 20 + 30 + 25.
    expect(linha.acc.bruto).toBeCloseTo(115, 2);
    // Orders 11, 12 e 20: a order 12 tem duas irmãs e conta uma vez (soma das linhas daria 4).
    expect(soma((l) => l.acc.pedidos)).toBe(4);
    expect(linha.acc.pedidos).toBe(3);
  });
});

// ---------------- Eventos, UFs, mix, campanhas ----------------
const mov = (over: Partial<Movimento>): Movimento => ({ id: 'm1', codigo: 'A', motivo: 'venda', quantidade: -1,
  custo_unitario: null, estoque_anterior: 1, estoque_resultante: 0, criado_em: '2026-09-10T12:00:00Z', ...over });
const dev = (over: Partial<Devolucao>): Devolucao => ({ id: 'd1', claim_id: 1, order_id: 10, stage: 'claim', status: 'closed',
  type: 'returns', reason_texto: null, reason_id: 'PDD9939', valor_em_jogo: null, return_status: null, return_status_money: 'refunded',
  acoes_pendentes: null, aberto_em: '2026-09-05T12:00:00Z', fechado_em: '2026-09-08T12:00:00Z', ...over });
const MLBS = new Map([['MLB1', ['A']], ['MLB3', ['A', 'B', 'C']]]);
const BASE = { movimentos: [] as Movimento[], moderacoes: [] as Moderacao[], devolucoes: [] as Devolucao[],
  ordersDosCodigos: new Set([10]), mlbs: MLBS, kitMultiplicador: null as number | null };

describe('vinculoDoMlb', () => {
  it('1 código exato; 2+ compartilhado; fora do mapa não resolvido', () => {
    expect(vinculoDoMlb('MLB1', MLBS)).toBe('exato');
    expect(vinculoDoMlb('MLB3', MLBS)).toBe('compartilhado');
    expect(vinculoDoMlb('MLB9', MLBS)).toBe('nao_resolvido');
  });
});

describe('montarEventos', () => {
  it('devolução: só returns com order do SKU; abertura e estorno viram 2 eventos; motivo cai no reason_id', () => {
    const ev = montarEventos({ ...BASE, devolucoes: [
      dev({}),
      dev({ id: 'd2', order_id: 99 }), // outro produto
      dev({ id: 'd3', type: 'mediations' }),
    ] });
    expect(ev.map((e) => e.id)).toEqual(['d1:abertura', 'd1:estorno']);
    expect(ev.map((e) => e.tipo)).toEqual(['devolucao_aberta', 'devolucao_estorno']);
    // código cru do ML (reason_id) não aparece: sem texto traduzido é "não informado"
    expect(ev[0].motivo).toBeNull();
    expect(ev[0].detalhe).not.toContain('PDD9939');
    expect(ev[0].detalhe).toContain('não informado');
    const comTexto = montarEventos({ ...BASE, devolucoes: [dev({ reason_texto: 'Defeito' })] })[0];
    expect(comTexto.motivo).toBe('Defeito');
    expect(comTexto.detalhe).toContain('Defeito');
  });

  it('moderação: detectada e resolvida viram 2 eventos com o vínculo do MLB', () => {
    const ev = montarEventos({ ...BASE, moderacoes: [
      { id: 'x', ml_item_id: 'MLB3', status: 'resolvida', motivo: 'foto', detectado_em: '2026-09-01T00:00:00Z', resolvido_em: '2026-09-02T00:00:00Z' },
      { id: 'y', ml_item_id: 'MLB9', status: 'ativa', motivo: null, detectado_em: '2026-09-03T00:00:00Z', resolvido_em: null },
    ] });
    expect(ev.map((e) => [e.id, e.tipo, e.vinculo, e.mlb])).toEqual([
      ['x:detectada', 'moderacao_detectada', 'compartilhado', 'MLB3'],
      ['x:resolvida', 'moderacao_resolvida', 'compartilhado', 'MLB3'],
      ['y:detectada', 'moderacao_detectada', 'nao_resolvido', 'MLB9'],
    ]);
  });

  it('ruptura/retorno só por transição; movimento sem saldo ignorado; entrada com custo', () => {
    const ev = montarEventos({ ...BASE, movimentos: [
      mov({ id: 'a', estoque_anterior: 5, estoque_resultante: 3 }), // sem transição
      mov({ id: 'b', estoque_anterior: 3, estoque_resultante: 0, criado_em: '2026-09-11T00:00:00Z' }),
      mov({ id: 'c', estoque_anterior: null, estoque_resultante: 0, criado_em: '2026-09-12T00:00:00Z' }),
      mov({ id: 'd', motivo: 'entrada', quantidade: 10, custo_unitario: 4.5, estoque_anterior: 0, estoque_resultante: 10, criado_em: '2026-09-13T00:00:00Z' }),
    ] });
    expect(ev.map((e) => e.id)).toEqual(['b:ruptura', 'd:entrada', 'd:retorno']);
    expect(ev[1].titulo).toContain('10 un.');
    expect(ev[1].titulo).toContain('4,50');
    expect(ev.every((e) => e.vinculo === 'exato')).toBe(true);
  });

  it('kit: ruptura quando floor(base/N) zera, não quando a base zera', () => {
    const ev = montarEventos({ ...BASE, kitMultiplicador: 3, movimentos: [
      mov({ id: 'a', estoque_anterior: 4, estoque_resultante: 2 }), // 1 kit → 0 kit
      mov({ id: 'b', estoque_anterior: 2, estoque_resultante: 0, criado_em: '2026-09-11T00:00:00Z' }), // 0 → 0
      mov({ id: 'c', estoque_anterior: 0, estoque_resultante: 3, criado_em: '2026-09-12T00:00:00Z' }), // 0 → 1
    ] });
    expect(ev.map((e) => e.id)).toEqual(['a:ruptura', 'c:retorno']);
  });

  it('família: o mesmo evento não duplica ao juntar códigos', () => {
    const m: Moderacao = { id: 'x', ml_item_id: 'MLB3', status: 'ativa', motivo: null, detectado_em: '2026-09-01T00:00:00Z', resolvido_em: null };
    const ev = montarEventos({ ...BASE, moderacoes: [m, m], devolucoes: [dev({}), dev({})] });
    expect(ev.map((e) => e.id)).toEqual(['x:detectada', 'd1:abertura', 'd1:estorno']);
  });
});

describe('perguntasPorIntervalo', () => {
  it('conta por intervalo meio-aberto', () => {
    const p = [{ criada_em: '2026-09-15T00:00:00Z' }, { criada_em: '2026-09-21T03:00:00.000Z' }, { criada_em: null }, { criada_em: '2026-01-01T00:00:00Z' }];
    expect(perguntasPorIntervalo(p, IVS)).toEqual([1, 1]);
  });
});

describe('ufsDoSku', () => {
  it('pack com 2 UFs: soma o bruto dos itens faturáveis do SKU pela UF do item, nunca o bruto do pack', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 9, uf: 'SP', total_amount: 20, itens: [item({ id: 'i1', codigo: 'A', quantity: 2, unit_price: 10 })] } as Partial<Venda>),
      venda({ id: 'b', order_id: 2, pack_id: 9, uf: 'RJ', total_amount: 30, itens: [item({ id: 'i2', codigo: 'A', quantity: 1, unit_price: 30 })] } as Partial<Venda>),
      venda({ id: 'c', order_id: 3, pack_id: 9, uf: 'RJ', total_amount: 50, itens: [item({ id: 'i3', codigo: 'B', quantity: 1, unit_price: 50 })] } as Partial<Venda>),
      venda({ id: 'd', order_id: 4, uf: null, total_amount: 7, itens: [item({ id: 'i4', codigo: 'A', quantity: 1, unit_price: 7 })] } as Partial<Venda>),
      venda({ id: 'e', order_id: 5, status: 'cancelled', uf: 'MG', total_amount: 9, itens: [item({ id: 'i5', codigo: 'A', quantity: 1, unit_price: 9 })] } as Partial<Venda>),
    ];
    expect(ufsDoSku(agrupar(vendas), ['A'])).toEqual({ valores: { SP: 20, RJ: 30 }, semUf: 7 });
  });
});

describe('mixDaFamilia', () => {
  const cat = (codigo: string, nome: string): CatalogoSku => ({ codigo, codigoPai: 'P', nomeFamilia: 'F', nome, cor: null, tamanho: null,
    estoque: 0, fornecedor: null, origem: null, ehKit: false, primeiraVenda: null, ultimaVenda: null,
    kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null });
  it('participação em unidades, delta de lucro contra o anterior, irmã sem venda aparece', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-15T12:00:00Z', total_amount: 30, liquido: 27, itens: [item({ id: 'i1', codigo: 'A', quantity: 3, unit_price: 10 })] }),
      venda({ id: 'b', order_id: 2, date_closed: '2026-09-15T12:00:00Z', total_amount: 10, liquido: 9, itens: [item({ id: 'i2', codigo: 'B', quantity: 1, unit_price: 10 })] }),
    ];
    const linhas = agregarPorSku(agrupar(vendas), S1, new Map(), new Set());
    const anterior = agregarPorSku(agrupar([vendas[0]]), S1, new Map(), new Set());
    const mix = mixDaFamilia(linhas, anterior, [cat('A', 'Azul'), cat('B', 'Verde'), cat('C', 'Rosa')]);
    // A: líquido 27 − custo 12 = 15 nos dois períodos; B: 9 − 4 = 5, sem venda no anterior (conta 0)
    expect(mix.find((m) => m.codigo === 'A')).toMatchObject({ titulo: 'Azul', unidades: 3, participacaoUnidades: 0.75, lucro: 15, deltaLucro: 0, semVendas: false });
    // B é irmã nova (sem linha no anterior, família com histórico): Δ = lucro inteiro, marcada para a UI explicar.
    expect(mix.find((m) => m.codigo === 'B')).toMatchObject({ unidades: 1, participacaoUnidades: 0.25, lucro: 5, deltaLucro: 5, novaNoPeriodo: true });
    expect(mix.filter((m) => m.novaNoPeriodo).map((m) => m.codigo)).toEqual(['B']);
    expect(mix.find((m) => m.codigo === 'C')).toMatchObject({ titulo: 'Rosa', unidades: 0, participacaoUnidades: 0, lucro: null, deltaLucro: null, semVendas: true });
  });

  it('só a composição do catálogo: produto de outro pack e SEM_CODIGO não entram nem no total', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-15T12:00:00Z', total_amount: 30, liquido: 27, itens: [item({ id: 'i1', codigo: 'A', quantity: 3, unit_price: 10 })] }),
      venda({ id: 'x', order_id: 2, date_closed: '2026-09-15T12:00:00Z', total_amount: 10, liquido: 9, itens: [item({ id: 'i2', codigo: 'Z', quantity: 5, unit_price: 2 })] }),
      venda({ id: 'y', order_id: 3, date_closed: '2026-09-15T12:00:00Z', total_amount: 10, liquido: 9, itens: [item({ id: 'i3', codigo: null, quantity: 4, unit_price: 2.5 })] }),
    ];
    const linhas = agregarPorSku(agrupar(vendas), S1, new Map(), new Set());
    const mix = mixDaFamilia(linhas, [], [cat('A', 'Azul'), cat('B', 'Verde')]);
    expect(mix.map((m) => m.codigo)).toEqual(['A', 'B']);
    expect(mix[0].participacaoUnidades).toBe(1);
  });

  it('família sem venda nenhuma no anterior: sem Δ (nunca o lucro inteiro como alta)', () => {
    const vendas = [venda({ id: 'a', order_id: 1, date_closed: '2026-09-15T12:00:00Z', total_amount: 30, liquido: 27,
      itens: [item({ id: 'i1', codigo: 'A', quantity: 3, unit_price: 10 })] })];
    const linhas = agregarPorSku(agrupar(vendas), S1, new Map(), new Set());
    const mix = mixDaFamilia(linhas, [], [cat('A', 'Azul'), cat('B', 'Verde')]);
    expect(mix.map((m) => m.deltaLucro)).toEqual([null, null]);
  });

  it('irmã que vendeu no anterior e zerou agora: delta mostra a queda', () => {
    const vendas = [venda({ id: 'b', order_id: 2, date_closed: '2026-09-15T12:00:00Z', total_amount: 60, liquido: 54,
      itens: [item({ id: 'i2', codigo: 'B', quantity: 1, unit_price: 60 })] })];
    const anterior = agregarPorSku(agrupar(vendas), S1, new Map(), new Set());
    expect(anterior[0].m.lucro).toBe(50); // 54 − 4
    const b = mixDaFamilia([], anterior, [cat('B', 'Verde')])[0];
    expect(b).toMatchObject({ lucro: null, deltaLucro: -50, semVendas: true });
  });
});

describe('situacaoCampanhas', () => {
  it('status do item e da campanha, vigência e última sincronização', () => {
    const r = situacaoCampanhas([{ ml_item_id: 'MLB1', promocao_id: 'P1', status: 'started', preco_promo: 19.9, sincronizado_em: '2026-09-20T00:00:00Z',
      promocao: { promocao_id: 'P1', nome: 'Dia do Cliente', tipo: 'DEAL', status: 'started', inicio: '2026-09-15T00:00:00Z', fim: '2026-09-30T00:00:00Z', sincronizado_em: '2026-09-21T00:00:00Z' } }]);
    expect(r).toEqual([{ mlb: 'MLB1', nome: 'Dia do Cliente', tipo: 'DEAL', statusItem: 'started', statusCampanha: 'started', precoPromo: 19.9,
      vigencia: { inicio: '2026-09-15T00:00:00Z', fim: '2026-09-30T00:00:00Z' }, sincronizadoEm: '2026-09-20T00:00:00Z' }]);
  });
});
