import { describe, expect, it } from 'vitest';
import { BASE_ACOS_VALIDADA, montarPainelAds, type FontePainelAds, type GrupoPainel } from '@/lib/ads-painel';

// Decisão do Diego em 05/10/2026, com os números do spike 055 (ADR-0179): semáforo ligado.
it('semáforo do ACOS de equilíbrio ligado', () => {
  expect(BASE_ACOS_VALIDADA).toBe(true);
});
import { janelaBRT, lucroPorFamilia, periodoAds } from '@/lib/ads-painel-dados';
import { diasEntre } from '@/lib/sku-ads';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { montarVendasSku } from '@/lib/vendas-sku';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CatalogoSku } from '@/lib/vendas-sku-catalogo';

const janela = { desde: '2026-09-01', ate: '2026-09-02' };
const agora = new Date('2026-10-04T15:00:00-03:00');
const dia = (d: string, cost: number, total = 0, direct = 0) =>
  ({ dia: d, cost, clicks: 0, prints: 0, direct_amount: direct, indirect_amount: total - direct, total_amount: total,
     coletado_em: '2026-10-04T12:00:00Z' });
const grupo = (id: number, cost: number, membros: string[], total = 0, direct = 0): GrupoPainel =>
  ({ ad_group_id: id, tipo: 'FAMILY', status: 'ACTIVE', cost, clicks: 0, prints: 0, direct_amount: direct,
     indirect_amount: total - direct, total_amount: total, membros });
const sync = { estado: 'ok', erro: null, ultimo_ok_em: '2026-10-04T14:00:00Z', carga_inicial_ok: true,
  cobertura_desde: '2026-06-29', conta_cobertura_desde: '2026-06-29' };
const base = (f: Partial<FontePainelAds> = {}) => ({
  fonte: { sync, conta: [dia('2026-09-01', 60), dia('2026-09-02', 40)], grupos: [], ...f },
  janela, agora, historicoDesde: '2026-01-01T03:00:00.000Z', baseAcosValidada: true,
  codigosPorMlb: new Map([['MLB1', ['A1']], ['MLB2', ['A2']], ['MLB3', ['B1']], ['MLB4', []]]),
  familiaDoCodigo: new Map([['A1', 'A'], ['A2', 'A'], ['B1', 'B']]),
  nomeDaFamilia: new Map<string, string>(),
  lucroPorFamilia: new Map([['A', { nome: 'Fam A', lucro: 250, brutoComCusto: 1000, fonteCusto: 'real' as const, markup: 0.5 }]]),
  lucroConta: { lucro: 300, fonteCusto: 'real' as const },
});

describe('montarPainelAds', () => {
  it('grupo com 2 cores da mesma família vai inteiro para a família; semáforo pelo ACOS direto', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 80, ['MLB1', 'MLB2'], 800, 700)] }));
    expect(p.familias).toHaveLength(1);
    expect(p.familias[0]).toMatchObject({ codigoPai: 'A', custo: 80, vendasTotais: 800, roas: 10, roasDireto: 8.75,
      acos: 0.1, lucroAntes: 250, resultado: 170, margemConsumida: 0.32, acosEquilibrio: 0.25, semaforo: 'dentro',
      custoCompartilhado: 0, motivo: null, markup: 0.5 });
    expect(p.familias[0].acosDireto).toBeCloseTo(80 / 700);
  });
  it('identidade exata: famílias + compartilhado + não identificado = total da conta', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1']), grupo(2, 20, ['MLB1', 'MLB3']), grupo(3, 10, [])] }));
    const c = p.conta!;
    expect(c).toMatchObject({ custo: 100, emFamilias: 50, compartilhado: 20, naoIdentificado: 30, naoIdentificadoPct: 0.3,
      divergente: false, resultado: 200 });
    expect(c.emFamilias + c.compartilhado + c.naoIdentificado!).toBe(c.custo);
    expect(p.compartilhados[0]).toMatchObject({ id: 2, familias: ['A', 'B'], semCodigo: 0 });
  });
  it('família tocada por grupo compartilhado: gasto exclusivo visível, resultado bloqueado, sem rateio', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1'], 500, 500), grupo(2, 20, ['MLB1', 'MLB3'])] }));
    const a = p.familias.find((f) => f.codigoPai === 'A')!;
    expect(a).toMatchObject({ custo: 50, custoCompartilhado: 20, resultado: null, margemConsumida: null, semaforo: null,
      motivo: 'compartilhado' });
  });
  it('MLB sem código → compartilhado, nunca a família', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1', 'MLB4'])] }));
    expect(p.familias.find((f) => f.codigoPai === 'A')?.custo ?? 0).toBe(0);
    expect(p.compartilhados[0]).toMatchObject({ semCodigo: 1 });
  });
  it('MLB ausente do mapa (buscarCodigosMlbs omite MLB sem código) → igual a sem código', () => {
    const b = base({ grupos: [grupo(1, 50, ['MLB1', 'MLB4'])] });
    b.codigosPorMlb.delete('MLB4');
    const p = montarPainelAds(b);
    expect(p.familias.find((f) => f.codigoPai === 'A')?.custo ?? 0).toBe(0);
    expect(p.compartilhados[0]).toMatchObject({ semCodigo: 1 });
  });
  it('grupos acima da conta → divergente: nada ajustado, não identificado indisponível', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 101, ['MLB1'])] }));
    expect(p.conta).toMatchObject({ custo: 100, emFamilias: 101, divergente: true, naoIdentificado: null, naoIdentificadoPct: null });
  });
  it('um centavo acima da conta já é divergência', () => {
    expect(montarPainelAds(base({ grupos: [grupo(1, 100.01, ['MLB1'])] })).conta?.divergente).toBe(true);
  });
  it('ruído de ponto flutuante abaixo do centavo não é divergência, e a identidade fecha em centavos', () => {
    const p = montarPainelAds(base({ conta: [dia('2026-09-01', 0.1), dia('2026-09-02', 0.2)],
      grupos: [grupo(1, 0.1, ['MLB1']), grupo(2, 0.2 + 1e-12, ['MLB3'])] }));
    const c = p.conta!;
    expect(c.divergente).toBe(false);
    expect(Math.round(c.emFamilias * 100) + Math.round(c.compartilhado * 100) + Math.round(c.naoIdentificado! * 100))
      .toBe(Math.round(c.custo * 100));
    expect(c.naoIdentificado).toBe(0);
  });
  it('série da conta sem cobrir o período → conta null, famílias continuam', () => {
    const p = montarPainelAds(base({ conta: [dia('2026-09-02', 40)], grupos: [grupo(1, 50, ['MLB1'])] }));
    expect(p.conta).toBeNull();
    expect(p.contaMotivo).toBe('cobertura');
    expect(p.familias).toHaveLength(1);
  });
  it('grupos sem cobertura do período (coleta ainda não leu ontem) → resultado e semáforo indisponíveis', () => {
    const p = montarPainelAds(base({ sync: { ...sync, ultimo_ok_em: '2026-09-02T14:00:00Z' }, grupos: [grupo(1, 50, ['MLB1'], 500, 500)] }));
    expect(p.gruposCobertos).toBe(false);
    expect(p.familias[0]).toMatchObject({ resultado: null, semaforo: null, motivo: 'cobertura' });
  });
  it('às 08:00 BRT (coleta de hoje ainda não rodou) o período termina anteontem e fica coberto', () => {
    const agora8 = new Date('2026-10-05T08:00:00-03:00');
    const s8 = { ...sync, ultimo_ok_em: '2026-10-04T14:17:00Z' };
    const j = periodoAds(7, agora8, s8.ultimo_ok_em);
    const conta = diasEntre(j.desde, j.ate).map((d) => dia(d, 10));
    const p = montarPainelAds({ ...base({ sync: s8, conta, grupos: [grupo(1, 30, ['MLB1'], 300, 300)] }), janela: j, agora: agora8 });
    expect(p.gruposCobertos).toBe(true);
    expect(p.conta).not.toBeNull();
    expect(p.familias.every((f) => f.motivo !== 'cobertura')).toBe(true);
  });
  it('família sem venda no período usa o nome do catálogo, não o código', () => {
    const p = montarPainelAds({ ...base({ grupos: [grupo(1, 30, ['MLB3'])] }), nomeDaFamilia: new Map([['B', 'Fam B do catálogo']]) });
    expect(p.familias[0]).toMatchObject({ codigoPai: 'B', nome: 'Fam B do catálogo' });
  });
  it('período antes do histórico de vendas → lucro desconhecido, nunca zero', () => {
    const b = base({ grupos: [grupo(1, 30, ['MLB3'])] });
    b.historicoDesde = '2026-09-02T03:00:00.000Z';
    const p = montarPainelAds(b);
    expect(p.familias[0]).toMatchObject({ lucroAntes: null, resultado: null, motivo: 'historico', markup: null });
    expect(p.conta?.lucroAntes).toBeNull();
  });
  it('histórico começando no meio do 1º dia do período bloqueia (ISO, não dia)', () => {
    const b = base({ grupos: [grupo(1, 30, ['MLB3'])] });
    b.historicoDesde = '2026-09-01T15:00:00.000Z';   // 12:00 BRT do 1º dia
    expect(montarPainelAds(b).familias[0].motivo).toBe('historico');
    b.historicoDesde = '2026-09-01T03:00:00.000Z';   // 00:00 BRT exato: coberto
    expect(montarPainelAds(b).familias[0].motivo).toBe('sem_vendas');
  });
  it('conta sem nenhuma venda faturável: lucro 0, resultado −despesa', () => {
    const b = base();
    b.lucroConta = { lucro: 0, fonteCusto: 'real' };
    b.lucroPorFamilia = new Map();
    expect(montarPainelAds(b).conta).toMatchObject({ lucroAntes: 0, resultado: -100 });
  });
  it('base do ACOS não validada: equilíbrio exibido, semáforo desligado', () => {
    const b = base({ grupos: [grupo(1, 80, ['MLB1', 'MLB2'], 800, 700)] });
    b.baseAcosValidada = false;
    const p = montarPainelAds(b);
    expect(p.semaforoLiberado).toBe(false);
    expect(p.familias[0]).toMatchObject({ acosEquilibrio: 0.25, semaforo: null, motivo: null });
  });
  it('família com gasto e sem venda: lucro 0, resultado −gasto, sem equilíbrio', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 30, ['MLB3'])] }));
    expect(p.familias[0]).toMatchObject({ codigoPai: 'B', lucroAntes: 0, resultado: -30, acosEquilibrio: null,
      semaforo: null, motivo: 'sem_vendas', roas: 0, acos: null, markup: null });
  });
  it('família só com canceladas/devolvidas (lucro null, fonte real) → sem vendas', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'])] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: null, brutoComCusto: 0, fonteCusto: 'real', markup: null });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: 0, motivo: 'sem_vendas' });
  });
  it('margem ≤ 0 → sem espaço para Ads', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100, 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: -5, brutoComCusto: 100, fonteCusto: 'real', markup: -0.1 });
    expect(montarPainelAds(b).familias[0].semaforo).toBe('sem_espaco');
  });
  it('ACOS direto acima do equilíbrio → acima (mesmo com ACOS total dentro)', () => {
    const f = montarPainelAds(base({ grupos: [grupo(1, 300, ['MLB1'], 2000, 1000)] })).familias[0];
    expect(f.acos).toBe(0.15);
    expect(f.semaforo).toBe('acima');
  });
  it('custo parcial → lucro mostrado, semáforo indisponível', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100, 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: 20, brutoComCusto: 80, fonteCusto: 'parcial', markup: 0.4 });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: 20, markup: null, acosEquilibrio: null, semaforo: null, motivo: 'custo_parcial' });
  });
  it('sem custo cadastrado → lucro null com motivo', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: null, brutoComCusto: 0, fonteCusto: 'sem_custo', markup: null });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: null, resultado: null, motivo: 'sem_custo' });
  });
  it('dias com atribuição em aberto contam como provisórios', () => {
    const p = montarPainelAds(base({ conta: [{ ...dia('2026-09-01', 60), coletado_em: '2026-09-05T12:00:00Z' },
      dia('2026-09-02', 40)] }));
    expect(p.conta?.diasAbertos).toBe(1);
  });
  it('estados na ordem de precedência', () => {
    expect(montarPainelAds(base({ sync: null })).estado).toBe('sem_coleta');
    expect(montarPainelAds(base({ sync: { ...sync, estado: 'sem_advertiser', carga_inicial_ok: false } })).estado).toBe('sem_advertiser');
    expect(montarPainelAds(base({ sync: { ...sync, carga_inicial_ok: false } })).estado).toBe('coletando');
    expect(montarPainelAds(base({ conta: [dia('2026-09-01', 0), dia('2026-09-02', 0)] })).estado).toBe('sem_ads');
    expect(montarPainelAds(base({ conta: [dia('2026-09-02', 0)] })).estado).toBe('ok');   // sem cobertura não afirma zero
    expect(montarPainelAds(base({ sync: { ...sync, ultimo_ok_em: '2026-10-01T00:00:00Z' } })).desatualizado).toBe(true);
  });
  it('famílias ordenadas por gasto', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 10, ['MLB1']), grupo(2, 50, ['MLB3'])] }));
    expect(p.familias.map((f) => f.codigoPai)).toEqual(['B', 'A']);
  });
});

// Sem mock: vendas reais → montarVendasSku → lucroPorFamilia (a MESMA função que o useAdsPainel chama) → montarPainelAds.
// Fixtures copiadas de tests/lib/vendas-sku.test.ts / useSkuDossie.test.ts (importar o arquivo registraria a suíte dele aqui).
describe('montarPainelAds × vendas reais (integração)', () => {
  const item = (over: Partial<VendaItem> = {}): VendaItem => ({ id: 'it1', ml_item_id: 'MLB1', variation_id: null,
    titulo: 'FITA', codigo: 'A1', cor: null, ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true,
    custo_congelado: null, ...over } as VendaItem);
  const venda = (over: Partial<Venda> = {}): Venda => ({ id: 'v1', order_id: 1, pack_id: null, status: 'paid',
    status_detail: null, date_closed: '2026-09-01T12:00:00Z', date_created: null, comprador_nick: 'c', comprador_nome: null,
    comprador_id: 100, uf: null, cidade: null, sacado_em: null, sacado_por: null, atualizado_em: '2026-09-01T12:00:00Z',
    total_amount: 10, paid_amount: 10, sale_fee_total: 0, frete_vendedor: null, liquido: 10, estorno: null,
    money_release_date: null, currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
    shipping_logistic: null, tracking_number: null, is_publiai: true, tem_devolucao: false, kit_item_id: null,
    itens: [item()], ...over } as Venda);
  const cat = (codigo: string, codigoPai: string, over: Partial<CatalogoSku> = {}): CatalogoSku => ({ codigo, codigoPai,
    nomeFamilia: `Fam ${codigoPai}`, nome: codigo, cor: null, tamanho: null, estoque: 5, fornecedor: null, origem: 'nacional',
    ehKit: false, primeiraVenda: '2026-01-01T03:00:00.000Z', ultimaVenda: null, kitMultiplicador: null, kitBaseCodigo: null,
    estoqueKit: null, ...over });

  it('kit, cancelada e item sem custo chegam ao painel com bruto, fonte de custo e motivo certos', () => {
    const custos: Record<string, number> = { A1: 4, K2: 8 };
    const vendas = [
      venda({ id: 'a', order_id: 1, itens: [item({ id: 'i1', codigo: 'A1', custo_congelado: 4 })] }),
      venda({ id: 'c', order_id: 2, status: 'cancelled', itens: [item({ id: 'i2', codigo: 'A1', custo_congelado: 4 })] }),
      venda({ id: 'k', order_id: 3, total_amount: 30, paid_amount: 30, liquido: 30, kit_item_id: 'MLBK',
        itens: [item({ id: 'i3', ml_item_id: 'MLBK', codigo: 'K2', unit_price: 30, custo_congelado: 8 })] }),
      venda({ id: 'b', order_id: 4, itens: [item({ id: 'i4', ml_item_id: 'MLBB', codigo: 'B1' })] }),
    ];
    const catalogo = [cat('A1', 'A'), cat('K2', 'K', { ehKit: true, kitMultiplicador: 2, kitBaseCodigo: 'A1' }), cat('B1', 'B')];
    const jv = janelaBRT(janela.desde, janela.ate);
    const vs = montarVendasSku({ vendas, agrupar: (v) => agruparPorPedido(v, (it) => custos[it.codigo ?? ''] ?? null),
      janela: jv, anterior: { desde: '2026-08-01T03:00:00.000Z', ate: jv.desde },
      catalogo: new Map(catalogo.map((c) => [c.codigo, c])), devolucoes: [] });

    const lucro = lucroPorFamilia(vs.linhas);
    expect(lucro.get('A')).toEqual({ nome: 'Fam A', lucro: 6, brutoComCusto: 10, fonteCusto: 'real', markup: 1.5 });   // cancelada fora
    expect(lucro.get('K')).toEqual({ nome: 'Fam K', lucro: 22, brutoComCusto: 30, fonteCusto: 'real', markup: 2.75 });
    expect(lucro.get('B')).toEqual({ nome: 'Fam B', lucro: null, brutoComCusto: 0, fonteCusto: 'sem_custo', markup: null });

    const p = montarPainelAds({ ...base({ grupos: [grupo(1, 2, ['MLB1'], 10, 10), grupo(2, 3, ['MLBK'], 30, 30),
      grupo(3, 1, ['MLBB'], 10, 10)] }),
      codigosPorMlb: new Map([['MLB1', ['A1']], ['MLBK', ['K2']], ['MLBB', ['B1']]]),
      familiaDoCodigo: new Map(catalogo.map((c) => [c.codigo, c.codigoPai!])),
      lucroPorFamilia: lucro, historicoDesde: vs.historicoDesde });
    const f = (c: string) => p.familias.find((x) => x.codigoPai === c)!;
    expect(f('A')).toMatchObject({ lucroAntes: 6, resultado: 4, acosEquilibrio: 0.6, fonteCusto: 'real', motivo: null });
    expect(f('K')).toMatchObject({ lucroAntes: 22, resultado: 19, fonteCusto: 'real', motivo: null });
    expect(f('K').acosEquilibrio).toBeCloseTo(22 / 30);
    expect(f('B')).toMatchObject({ lucroAntes: null, resultado: null, acosEquilibrio: null, semaforo: null, motivo: 'sem_custo' });
  });
});
