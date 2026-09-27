import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { conjuntoTrafego, montarTrafego, diasDoIntervalo, faixaTrafego, type FonteTrafego } from '@/lib/sku-trafego';
import type { VisitaDia, PrecoDia } from '@/lib/sku-dossie-dados';
import { intervalosBRT } from '@/lib/calendario-brt';
import type { Venda, VendaItem } from '@/lib/faturamento';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: 'A', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over };
}
function venda(over: Partial<Venda> = {}): Venda {
  return { id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-15T12:00:00Z', date_created: null, comprador_nick: 'c', comprador_id: 100,
    total_amount: 10, paid_amount: 10, sale_fee_total: 1, frete_vendedor: null, liquido: 9, estorno: null,
    money_release_date: null, currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over };
}
const agrupar = (vs: Venda[]) => agruparPorPedido(vs, () => 4);
const AGORA = new Date('2026-10-01T12:00:00Z');
// Semanas BRT de 14/09 (dias 14..20) e 21/09 (dias 21..27).
const IVS = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-27T02:59:59.999Z', 'semana', AGORA);

/** Uma linha por dia de `de` a `ate` (inclusive, dia do mês de set/2026). */
function dias(mlb: string, de: number, ate: number, estado: VisitaDia['estado'] = 'ok', visitas: number | null = 10): VisitaDia[] {
  const out: VisitaDia[] = [];
  for (let d = de; d <= ate; d++) out.push({ ml_item_id: mlb, dia: `2026-09-${String(d).padStart(2, '0')}`, visitas, estado });
  return out;
}
const fonte = (visitas: VisitaDia[], precos: PrecoDia[] = [], sync: FonteTrafego['sync'] = { estado: 'ok', carga_inicial_concluida_em: '2026-09-01T00:00:00Z', ultimo_ok_em: '2026-10-01T06:00:00Z' }): FonteTrafego =>
  ({ visitas, precos, sync });

describe('diasDoIntervalo / faixaTrafego', () => {
  it('dias BRT literais do intervalo, cortados em hoje (BRT); faixa do 1º ao último', () => {
    expect(diasDoIntervalo(IVS[0], AGORA)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    // hoje = 22/09 BRT (00:30 do dia 23 em UTC ainda é 22 em BRT) → a semana de 21 só tem 21 e 22
    expect(diasDoIntervalo(IVS[1], new Date('2026-09-23T00:30:00Z'))).toEqual(['2026-09-21', '2026-09-22']);
    expect(faixaTrafego(IVS)).toEqual({ desde: '2026-09-14', ate: '2026-09-27' });
  });
});

describe('conjuntoTrafego', () => {
  it('SKU: exclusivos; só compartilhados → anúncio; nada → indisponível; família: só MLB com todos os códigos dela', () => {
    const mlbs = new Map([['MLB1', ['A']], ['MLB2', ['A', 'B']], ['MLB3', ['C']]]);
    expect(conjuntoTrafego({ tipo: 'sku', codigo: 'A' }, ['A'], mlbs)).toMatchObject({ alcance: 'sku', mlbs: ['MLB1'] });
    expect(conjuntoTrafego({ tipo: 'sku', codigo: 'B' }, ['B'], mlbs)).toMatchObject({ alcance: 'anuncio', mlbs: ['MLB2'], codigosExtras: ['A'] });
    // não resolvido: vendas_sku_mlbs(['Z']) não traz MLB nenhum
    expect(conjuntoTrafego({ tipo: 'sku', codigo: 'Z' }, ['Z'], new Map([['MLB4', []]]))).toMatchObject({ alcance: 'indisponivel', mlbs: [] });
    // família {A, C}: MLB2 tem B (fora) → fica de fora
    expect(conjuntoTrafego({ tipo: 'familia', codigoPai: 'P' }, ['A', 'C'], mlbs)).toMatchObject({ alcance: 'familia', mlbs: ['MLB1', 'MLB3'], codigosExtras: [] });
    expect(conjuntoTrafego({ tipo: 'familia', codigoPai: 'P' }, ['B'], mlbs)).toMatchObject({ alcance: 'indisponivel', mlbs: [] });
  });
});

describe('montarTrafego', () => {
  const base = { agrupar, intervalos: IVS, agora: AGORA };

  it('Review Focus 1: MLB multi-cor → alcance anúncio, métrica do anúncio inteiro (vendas de todas as cores)', () => {
    const mlbs = new Map([['MLB2', ['A', 'B']]]);
    const vendas = [
      venda({ id: 'a', order_id: 1, itens: [item({ ml_item_id: 'MLB2', codigo: 'A', quantity: 2 })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ ml_item_id: 'MLB2', codigo: 'B', quantity: 3 })] }),
    ];
    const t = montarTrafego({ ...base, alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs, vendas,
      fonte: fonte(dias('MLB2', 14, 27)) });
    expect(t.alcance).toBe('anuncio');
    expect(t.porMlb).toEqual([{ mlb: 'MLB2', vinculo: 'compartilhado', codigos: ['A', 'B'], considerado: true }]);
    // 5 un. (A + B) ÷ 70 visitas; nunca 2/70 "da cor"
    expect(t.serie[0]).toMatchObject({ visitas: 70, unidades: 5, unidadesPorVisita: 5 / 70, estados: { ok: 7, pendente: 0, falha: 0, ausente: 0 } });
    expect(t.estadoColeta).toBe('ok');
    expect(t.calendario).toBe('brt');
  });

  it('Review Focus 2: dia pendente → visitas e métrica null com cobertura; zero ok conta como zero', () => {
    const mlbs = new Map([['MLB1', ['A']]]);
    const visitas = [...dias('MLB1', 14, 19), ...dias('MLB1', 20, 20, 'pendente', 3), ...dias('MLB1', 21, 27, 'ok', 0)];
    const vendas = [venda({ id: 'a', itens: [item({ quantity: 1 })] })];
    const t = montarTrafego({ ...base, alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs, vendas, fonte: fonte(visitas) });
    expect(t.alcance).toBe('sku');
    expect(t.serie[0]).toMatchObject({ visitas: null, unidadesPorVisita: null, estados: { ok: 6, pendente: 1, falha: 0, ausente: 0 } });
    // semana só com zeros ok: visitas 0 (número), métrica null (nunca Infinity)
    expect(t.serie[1]).toMatchObject({ visitas: 0, unidades: 0, unidadesPorVisita: null, estados: { ok: 7, pendente: 0, falha: 0, ausente: 0 } });
  });

  it('dia ausente e falha também derrubam a métrica; zero visitas com venda → null, não Infinity', () => {
    const mlbs = new Map([['MLB1', ['A']]]);
    const visitas = [...dias('MLB1', 14, 18), ...dias('MLB1', 19, 19, 'falha', null), ...dias('MLB1', 21, 27, 'ok', 0)];
    const vendas = [venda({ id: 'a', date_closed: '2026-09-22T12:00:00Z' })];
    const t = montarTrafego({ ...base, alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs, vendas, fonte: fonte(visitas) });
    expect(t.serie[0]).toMatchObject({ visitas: null, estados: { ok: 5, pendente: 0, falha: 1, ausente: 1 } });
    expect(t.serie[1]).toMatchObject({ visitas: 0, unidades: 1, unidadesPorVisita: null });
  });

  it('família mista: MLB exclusivo conta; MLB compartilhado com código de fora não entra (nem visitas nem vendas)', () => {
    const mlbs = new Map([['MLB1', ['A']], ['MLB2', ['C', 'X']]]);
    const vendas = [
      venda({ id: 'a', order_id: 1, itens: [item({ ml_item_id: 'MLB1', codigo: 'A', quantity: 2 })] }),
      venda({ id: 'c', order_id: 2, itens: [item({ ml_item_id: 'MLB2', codigo: 'C', quantity: 5 })] }),
    ];
    const t = montarTrafego({ ...base, alvo: { tipo: 'familia', codigoPai: 'P' }, codigos: ['A', 'C'], mlbs, vendas,
      fonte: fonte([...dias('MLB1', 14, 27), ...dias('MLB2', 14, 27, 'ok', 100)]) });
    expect(t.alcance).toBe('familia');
    expect(t.porMlb.find((m) => m.mlb === 'MLB2')).toMatchObject({ considerado: false, vinculo: 'compartilhado' });
    expect(t.serie[0]).toMatchObject({ visitas: 70, unidades: 2, unidadesPorVisita: 2 / 70 });
  });

  it('venda do mesmo código por outro MLB e venda dentro de kit ficam fora do numerador; cancelada também', () => {
    const mlbs = new Map([['MLB1', ['A']]]);
    const vendas = [
      venda({ id: 'a', order_id: 1, itens: [item({ ml_item_id: 'MLB1', quantity: 1 })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ ml_item_id: 'MLB9', quantity: 4 })] }), // outro MLB, mesmo código
      venda({ id: 'k', order_id: 3, kit_item_id: 'MLBK', itens: [item({ ml_item_id: 'MLB1', quantity: 6 })] } as Partial<Venda>),
      venda({ id: 'x', order_id: 4, status: 'cancelled', itens: [item({ ml_item_id: 'MLB1', quantity: 8 })] }),
    ];
    const t = montarTrafego({ ...base, alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs, vendas, fonte: fonte(dias('MLB1', 14, 27)) });
    expect(t.serie[0]).toMatchObject({ unidades: 1, visitas: 70, unidadesPorVisita: 1 / 70 });
  });

  it('vendas repetidas (dossiê + extras do anúncio) contam uma vez', () => {
    const mlbs = new Map([['MLB2', ['A', 'B']]]);
    const v = venda({ id: 'a', itens: [item({ ml_item_id: 'MLB2', quantity: 2 })] });
    const t = montarTrafego({ ...base, alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs, vendas: [v, v], fonte: fonte(dias('MLB2', 14, 27)) });
    expect(t.serie[0].unidades).toBe(2);
  });

  it('preço observado: mín./máx. por intervalo dos MLBs considerados; último para o cabeçalho', () => {
    const mlbs = new Map([['MLB1', ['A']], ['MLB2', ['A', 'B']]]);
    const precos: PrecoDia[] = [
      { ml_item_id: 'MLB1', dia: '2026-09-15', preco: 20, observado_em: '2026-09-15T13:00:00Z' },
      { ml_item_id: 'MLB1', dia: '2026-09-17', preco: 18, observado_em: '2026-09-17T13:00:00Z' },
      { ml_item_id: 'MLB2', dia: '2026-09-16', preco: 5, observado_em: '2026-09-16T13:00:00Z' }, // fora do conjunto
      { ml_item_id: 'MLB1', dia: '2026-09-22', preco: 19, observado_em: '2026-09-22T13:00:00Z' },
    ];
    const t = montarTrafego({ ...base, alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs, vendas: [], fonte: fonte(dias('MLB1', 14, 27), precos) });
    expect(t.serie[0].precoObservado).toEqual({ min: 18, max: 20 });
    expect(t.serie[1].precoObservado).toEqual({ min: 19, max: 19 });
    expect(t.precoAtual).toEqual({ preco: 19, observadoEm: '2026-09-22T13:00:00Z', mlb: 'MLB1' });
  });

  it('estadoColeta: sem linha de sync/sem dados → sem_coleta; carga inicial em curso ou MLB sem dado → parcial', () => {
    const mlbs = new Map([['MLB1', ['A']], ['MLB3', ['A']]]);
    const p = { ...base, alvo: { tipo: 'sku', codigo: 'A' } as const, codigos: ['A'], mlbs, vendas: [] };
    expect(montarTrafego({ ...p, fonte: fonte([], [], null) }).estadoColeta).toBe('sem_coleta');
    expect(montarTrafego({ ...p, fonte: fonte([]) }).estadoColeta).toBe('sem_coleta');
    const cheio = [...dias('MLB1', 10, 27), ...dias('MLB3', 12, 27)];
    expect(montarTrafego({ ...p, fonte: fonte(dias('MLB1', 14, 27)) }).estadoColeta).toBe('parcial');
    expect(montarTrafego({ ...p, fonte: fonte(cheio, [], { estado: 'sincronizando', carga_inicial_concluida_em: null, ultimo_ok_em: null }) }).estadoColeta).toBe('parcial');
    const ok = montarTrafego({ ...p, fonte: fonte(cheio) });
    expect(ok.estadoColeta).toBe('ok');
    expect(ok.coberturaDesde).toBe('2026-09-10');
  });

  it('fonte carregando/erro: alcance e porMlb já saem; série vazia; indisponível nunca espera', () => {
    const mlbs = new Map([['MLB1', ['A']]]);
    const p = { ...base, alvo: { tipo: 'sku', codigo: 'A' } as const, codigos: ['A'], mlbs, vendas: [] };
    expect(montarTrafego({ ...p, fonte: 'erro' })).toMatchObject({ estadoColeta: 'erro', alcance: 'sku', serie: [] });
    expect(montarTrafego({ ...p, fonte: 'carregando' })).toMatchObject({ estadoColeta: 'carregando', serie: [] });
    const ind = montarTrafego({ ...p, mlbs: new Map(), fonte: 'carregando' });
    expect(ind).toMatchObject({ alcance: 'indisponivel', estadoColeta: 'sem_coleta' });
    expect(ind.serie.every((s) => s.visitas == null && s.unidadesPorVisita == null)).toBe(true);
  });
});
