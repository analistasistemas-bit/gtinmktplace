import { describe, expect, it } from 'vitest';
import { montarCatalogo, parsePrecoParaGanhar, perfisPrioritarios, posicaoPorPreco } from '../catalogo.ts';
import type { VendedorML } from '../tipos.ts';

const item = (id: string, seller: number, price: number, extra: Record<string, unknown> = {}) => ({
  item_id: id, seller_id: seller, price, listing_type_id: 'gold_special', shipping: { free_shipping: false, logistic_type: 'cross_docking' }, ...extra,
});
const vend = (uf: string | null, medalha: string | null): VendedorML => ({ nickname: 'X', nivel: '5_green', medalha, vendas: 10, periodo: null, uf });
const AGORA = '2026-10-22T20:00:00.000Z';

describe('posicaoPorPreco', () => {
  it('1 + ofertas estritamente mais baratas; empate divide a posição', () => {
    expect(posicaoPorPreco([10, 10, 12], 10)).toEqual({ posicao: 1, empatada: true });
    expect(posicaoPorPreco([10, 10, 12], 12)).toEqual({ posicao: 3, empatada: false });
  });
});

describe('perfisPrioritarios', () => {
  it('nossa conta, vencedor e depois por menor preço, sem repetir, até o limite', () => {
    const ofertas = [item('A', 3, 30), item('B', 1, 10), item('C', 2, 20), item('D', 1, 15), item('E', 4, 40)];
    expect(perfisPrioritarios(ofertas, { sellerId: 4 }, 3, 3)).toEqual([3, 4, 1]);
    // Conta da org fora da ficha não gasta consulta.
    expect(perfisPrioritarios(ofertas, { sellerId: 4 }, 9, 3)).toEqual([4, 1, 2]);
    expect(perfisPrioritarios(ofertas, null, null, 20)).toEqual([1, 2, 3, 4]);
  });
});

describe('montarCatalogo (ADR-0189 D-12, Task 23)', () => {
  const produto = { buy_box_winner: { item_id: 'B', price: 10, seller_id: 1 } };
  const itens = {
    paging: { total: 3 },
    results: [
      item('A', 3, 30, { shipping: { free_shipping: true, logistic_type: 'fulfillment' }, official_store_id: 77, listing_type_id: 'gold_pro' }),
      item('B', 1, 10),
      item('C', 9, 20),
    ],
  };
  const perfis = new Map<number, VendedorML | null>([[1, vend('SP', 'gold')], [3, vend('RS', null)], [9, vend(null, 'platinum')]]);

  it('ofertas por preço, vencedora só pelo item_id do ML, "Sua" pela conta da org e resumo', () => {
    const r = montarCatalogo({ produto, itens, contaOrg: '9', perfis, ptw: null, coletadoEm: AGORA });
    expect(r.ofertas.map((o) => [o.itemId, o.vencedora, o.propria])).toEqual([['B', true, false], ['C', false, true], ['A', false, false]]);
    expect(r.ofertas[2]).toMatchObject({ full: true, freteGratis: true, lojaOficial: true, tipo: 'gold_pro' });
    expect(r.vencedor).toEqual({ itemId: 'B', sellerId: 1, preco: 10, origem: 'api' });
    expect(r.leitura).toEqual({ carregadas: 3, total: 3, completa: true });
    expect(r.resumo).toMatchObject({ vendedores: 3, menorPreco: 10, maiorPreco: 30, full: 1, freteGratis: 1, lojasOficiais: 1, perfisCarregados: 3 });
    expect(r.resumo.porUf).toEqual({ SP: 1, RS: 1, nao_informado: 1 });
    expect(r.resumo.porMedalha).toEqual({ platinum: 1, gold: 1, silver: 0, sem: 1, nao_informado: 0 });
    expect(r.participacao).toEqual({ estado: 'participa', itemId: 'C', preco: 20, posicao: 2, empatada: false, ptw: null });
    expect(r.coletadoEm).toBe(AGORA);
  });

  it('sem buy_box_winner: nenhum vencedor (nunca inferido pelo menor preço)', () => {
    const r = montarCatalogo({ produto: {}, itens, contaOrg: null, perfis, ptw: null, coletadoEm: AGORA });
    expect(r.vencedor).toBeNull();
    expect(r.ofertas.some((o) => o.vencedora)).toBe(false);
    expect(r.participacao).toEqual({ estado: 'sem_conexao' });
  });

  it('sem buy_box_winner na API: vencedor = item da buy box da página, só se estiver entre as ofertas', () => {
    const r = montarCatalogo({ produto: null, itens, contaOrg: null, perfis, ptw: null, coletadoEm: AGORA, itemDaPagina: 'C' });
    expect(r.vencedor).toEqual({ itemId: 'C', sellerId: 9, preco: 20, origem: 'pagina' });
    expect(r.ofertas.find((o) => o.itemId === 'C')!.vencedora).toBe(true);
    expect(montarCatalogo({ produto: null, itens, contaOrg: null, perfis, ptw: null, coletadoEm: AGORA, itemDaPagina: 'MLB404' }).vencedor).toBeNull();
    // API informou: prevalece sobre a página.
    expect(montarCatalogo({ produto, itens, contaOrg: null, perfis, ptw: null, coletadoEm: AGORA, itemDaPagina: 'C' }).vencedor?.itemId).toBe('B');
  });

  it('vendedor sem perfil carregado conta como não informado (não como "sem medalha")', () => {
    const r = montarCatalogo({ produto, itens, contaOrg: '5', perfis: new Map(), ptw: null, coletadoEm: AGORA });
    expect(r.resumo.porMedalha.nao_informado).toBe(3);
    expect(r.resumo.porMedalha.sem).toBe(0);
    expect(r.ofertas[0].vendedor).toBeNull();
    expect(r.participacao).toEqual({ estado: 'nao_participa' });
  });

  it('ficha parcial: leitura incompleta e nossa oferta ausente vira "não localizada"', () => {
    const parcial = { ...itens, paging: { total: 140 } };
    const r = montarCatalogo({ produto, itens: parcial, contaOrg: '5', perfis, ptw: null, coletadoEm: AGORA });
    expect(r.leitura).toEqual({ carregadas: 3, total: 140, completa: false });
    expect(r.participacao).toEqual({ estado: 'nao_localizada' });
  });

  it('ficha parcial com a nossa oferta lida: posição e menor/maior preço indisponíveis (não presumidos)', () => {
    const parcial = { ...itens, paging: { total: 140 } };
    const r = montarCatalogo({ produto, itens: parcial, contaOrg: '9', perfis, ptw: null, coletadoEm: AGORA });
    expect(r.participacao).toMatchObject({ estado: 'participa', itemId: 'C', posicao: null, empatada: false });
    expect([r.resumo.menorPreco, r.resumo.maiorPreco]).toEqual([null, null]);
  });

  it('preço para ganhar da nossa oferta entra na participação', () => {
    const ptw = parsePrecoParaGanhar({ status: 'competing', price_to_win: 18.5, current_price: 20 });
    const r = montarCatalogo({ produto, itens, contaOrg: '9', perfis, ptw, coletadoEm: AGORA });
    expect(r.participacao).toMatchObject({ estado: 'participa', ptw: { status: 'competing', precoParaGanhar: 18.5 } });
  });

  it('parsePrecoParaGanhar: só o vocabulário documentado (referência de preço não serve)', () => {
    expect(parsePrecoParaGanhar({ status: 'winning', price_to_win: null })).toEqual({ status: 'winning', precoParaGanhar: null });
    expect(parsePrecoParaGanhar({ status: 'with_benchmark_high', price_to_win: 10 })).toBeNull();
    expect(parsePrecoParaGanhar(null)).toBeNull();
  });
});
