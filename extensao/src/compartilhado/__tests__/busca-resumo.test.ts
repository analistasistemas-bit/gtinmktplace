// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { filtrarCards, ordenarCards, participacaoNosPisos, resumoBusca, resumoEnriquecimento, type ResultadoBusca } from '../busca-resumo';
import { enriquecimentoVazio } from '../enriquecimento';
import { lerBusca, type CardBusca } from '../../leitura/busca';

const card = (itemId: string, o: Partial<CardBusca> = {}): CardBusca => ({
  itemId, catalogProductId: null, userProductId: null, posicao: null, titulo: itemId, preco: 100, vendedor: null, nota: null,
  vendidosTexto: null, freteGratis: null, full: null, lojaOficial: null, patrocinado: false, selos: [], miniaturaUrl: null, identidadeConflitante: false, ocorrencias: [], ...o,
});
const ok = (pct: number, premium = pct - 4): ResultadoBusca => ({
  itemId: 'x', estado: 'ok', fonte: 'catalogo', codigo: '001',
  margem: { preco: 100, classico: { estado: 'ok', valor: { margemPct: pct, lucro: pct } as never }, premium: { estado: 'ok', valor: { margemPct: premium, lucro: premium } as never } },
  custo: {} as never,
});

const cards = [
  card('MLB1', { preco: 50, vendidosTexto: '+10mil vendidos', full: true, catalogProductId: 'MLB100', lojaOficial: true, selos: ['OFERTA DO DIA'] }),
  card('MLB2', { preco: 80, vendidosTexto: '+500 vendidos', freteGratis: true, patrocinado: true, catalogProductId: 'MLB100' }),
  card('MLB3', { preco: 20, vendidosTexto: '4 vendidos' }),
  card('MLB4', { preco: null }),
];

const VINC = { fonte: 'catalogo' as const, codigo: '001' };
const meta = (proprio: boolean | null, vinculo: typeof VINC | null) => ({ itemId: 'x', proprio, vinculo });

describe('resumoBusca (Task 22)', () => {
  it('conta por produto único e soma só os mínimos informados, sem somar o mesmo catálogo duas vezes', () => {
    const r = resumoBusca(cards, { MLB1: meta(false, VINC) }, 6);
    expect(r).toMatchObject({
      ocorrencias: 6, produtos: 4, menorPreco: 20, maiorPreco: 80, full: 1, freteGratis: 1, oficiais: 1, patrocinados: 1,
      comOferta: 1, comCatalogo: 2, semCatalogo: 2, vinculados: 1,
      vendidosMinimos: { soma: 10004, cobertura: 2, grupos: 3 },
    });
  });
});

describe('identificação (Task 5): anúncio próprio e SKU vinculado independentes, desconhecido nunca vira 0', () => {
  it('conta meus e vinculados pelos metadados; sem metadado = não identificado', () => {
    const r = resumoBusca(cards, { MLB1: meta(true, null), MLB2: meta(true, VINC), MLB3: meta(null, VINC) }, 4);
    expect(r).toMatchObject({ identificados: 3, meus: 2, vinculados: 2, proprioDesconhecido: 2, proprioIndisponivel: 1 });
    expect(resumoBusca(cards, {}, 4)).toMatchObject({ identificados: 0, meus: 0, vinculados: 0, proprioDesconhecido: 4 });
  });
  it('filtros meus e vinculados são distintos', () => {
    const m = { MLB1: meta(true, null), MLB2: meta(false, VINC), MLB3: meta(true, VINC) };
    expect(filtrarCards(cards, m, new Set(['meus'])).map((c) => c.itemId)).toEqual(['MLB1', 'MLB3']);
    expect(filtrarCards(cards, m, new Set(['vinculados'])).map((c) => c.itemId)).toEqual(['MLB2', 'MLB3']);
    expect(filtrarCards(cards, m, new Set(['meus', 'vinculados'])).map((c) => c.itemId)).toEqual(['MLB3']);
  });
});

describe('totais por grupo de vendas (modo busca completo)', () => {
  const oc = (preco: number | null, posicao = 1, vendidosTexto: string | null = '+100 vendidos') => ({ posicao, patrocinado: false, preco, vendidosTexto });
  it('volume: menor contribuição completa do grupo, sem misturar piso de um card com preço de outro', () => {
    const g = [
      card('MLB1', { catalogProductId: 'MLB100', vendidosTexto: '+100 vendidos', preco: 30, ocorrencias: [oc(30), oc(20, 2)] }),
      card('MLB2', { catalogProductId: 'MLB100', vendidosTexto: null, preco: 10, ocorrencias: [oc(10, 1, null)] }),
      card('MLB3', { vendidosTexto: '+10 vendidos', preco: null, ocorrencias: [oc(null, 1, '+10 vendidos')] }),
    ];
    const r = resumoBusca(g, {}, 4);
    expect(r.volumeMinimo).toEqual({ centavos: 200000, cobertura: 1, grupos: 2, conflitos: 0 });
    expect(r.vendidosMinimos).toMatchObject({ soma: 110, cobertura: 2, grupos: 2 });
    expect(r).toMatchObject({ ocorrencias: 4, produtos: 3 });
  });
  it('/up/ comprovada propaga o catálogo do outro item; /up/ com dois catálogos exclui o grupo e conta conflito', () => {
    const prop = [
      card('MLB1', { catalogProductId: 'MLB100', userProductId: 'MLBU1', vendidosTexto: '+50 vendidos', ocorrencias: [oc(10, 1, '+50 vendidos')] }),
      card('MLB2', { userProductId: 'MLBU1', vendidosTexto: '+50 vendidos', ocorrencias: [oc(8)] }),
    ];
    expect(resumoBusca(prop, {}, 2).vendidosMinimos).toMatchObject({ soma: 50, grupos: 1 });
    const conf = [
      card('MLB1', { catalogProductId: 'MLB100', userProductId: 'MLBU1', vendidosTexto: '+50 vendidos', ocorrencias: [oc(10)] }),
      card('MLB2', { catalogProductId: 'MLB200', userProductId: 'MLBU1', vendidosTexto: '+70 vendidos', ocorrencias: [oc(8)] }),
      card('MLB3', { vendidosTexto: '+5 vendidos', ocorrencias: [oc(1, 1, '+5 vendidos')] }),
    ];
    const r = resumoBusca(conf, {}, 3);
    expect(r.vendidosMinimos).toMatchObject({ soma: 5, cobertura: 1, grupos: 1 });
    expect(r.volumeMinimo).toMatchObject({ centavos: 500, grupos: 1, conflitos: 1 });
  });
});

describe('filtrarCards / ordenarCards', () => {
  const resultados = { MLB1: ok(12), MLB2: ok(30), MLB3: { itemId: 'MLB3', estado: 'sem_vinculo' } as ResultadoBusca };
  it('filtros combinam (e)', () => {
    const m = { MLB1: meta(false, VINC), MLB2: meta(false, VINC), MLB3: meta(false, null) };
    expect(filtrarCards(cards, m, new Set(['vinculados'])).map((c) => c.itemId)).toEqual(['MLB1', 'MLB2']);
    expect(filtrarCards(cards, m, new Set(['vinculados', 'full'])).map((c) => c.itemId)).toEqual(['MLB1']);
    expect(filtrarCards(cards, {}, new Set(['catalogo'])).map((c) => c.itemId)).toEqual(['MLB1', 'MLB2']);
  });
  it('ordena por vendidos (mínimo), preço e margem; desconhecidos sempre no fim', () => {
    expect(ordenarCards(cards, resultados, 'vendidos').map((c) => c.itemId)).toEqual(['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    expect(ordenarCards(cards, resultados, 'preco').map((c) => c.itemId)).toEqual(['MLB3', 'MLB1', 'MLB2', 'MLB4']);
    expect(ordenarCards(cards, resultados, 'margem').map((c) => c.itemId)).toEqual(['MLB2', 'MLB1', 'MLB3', 'MLB4']);
  });
});

describe('faixa de preço por aparição (revisão final)', () => {
  it('menor e maior entre todas as ocorrências, não só o preço do card', () => {
    const oc = (preco: number | null) => ({ posicao: 1, patrocinado: false, preco, vendidosTexto: null });
    const c = card('MLB1', { preco: 10, ocorrencias: [oc(10), oc(30)] });
    expect(resumoBusca([c, card('MLB2', { preco: 20, ocorrencias: [] })], {}, 3)).toMatchObject({ menorPreco: 10, maiorPreco: 30 });
  });
});

describe('fix rodada 1', () => {
  it('piso só pareia com o preço da mesma ocorrência: patrocinado R$10 sem vendidos + orgânico R$30 com +100 = R$3.000', () => {
    const c = card('MLB1', { vendidosTexto: '+100 vendidos', ocorrencias: [
      { posicao: 1, patrocinado: true, preco: 10, vendidosTexto: null },
      { posicao: 2, patrocinado: false, preco: 30, vendidosTexto: '+100 vendidos' },
    ] });
    expect(resumoBusca([c], {}, 2).volumeMinimo).toMatchObject({ centavos: 300000, cobertura: 1 });
  });
  it('conflito de catálogo do mesmo item (leitura → resumo): fora dos totais e contado', () => {
    const outro = 'https://www.mercadolivre.com.br/y/p/MLB77777777#wid=MLB4053374163&position=9';
    const um = 'https://www.mercadolivre.com.br/x/p/MLB32466350#wid=MLB4053374163&position=5';
    const li = (href: string) => `<div class="poly-card"><a class="poly-component__title" href="${href}">a</a>
      <div class="poly-component__review-compacted">4.9 | +100 vendidos</div>
      <div class="poly-price__current"><span class="andes-money-amount__fraction">10</span></div></div>`;
    document.body.innerHTML = li(um) + li(outro);
    const r = resumoBusca(lerBusca(document), {}, 2);
    expect(r.vendidosMinimos).toMatchObject({ soma: 0, cobertura: 0, grupos: 0, conflitos: 1 });
    expect(r.volumeMinimo).toMatchObject({ centavos: 0, grupos: 0, conflitos: 1 });
  });
});

describe('resumoEnriquecimento (Task 10)', () => {
  const ex = (sellerId: number | null, tipo: string | null = 'gold_special') => ({ estado: 'ok', preco: 100, sellerId, tipo, comissao: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } });
  const of = (vendedoresIdentificados: number, completa: boolean, exatas: Record<string, unknown>) =>
    ({ estado: 'ok', total: vendedoresIdentificados, lidas: vendedoresIdentificados, vendedoresIdentificados, ofertasSemVendedor: 0, completa, exatas }) as never;

  it('medalha e UF por vendedor ÚNICO dos cards identificados; desconhecidos à parte, com denominadores', () => {
    const e = enriquecimentoVazio();
    e.catalogos.MLB1 = { ofertas: of(3, true, { A1: ex(7), A2: ex(7, 'gold_pro'), A3: ex(8) }) };
    e.catalogos.MLB2 = { ofertas: of(40, true, { B1: ex(9, null), B2: { estado: 'nao_encontrada', preco: 100 } }) };
    e.catalogos.MLB3 = { ofertas: of(12, false, { C1: ex(null) }) };
    e.vendedores = { 7: { estado: 'ok', nome: null, medalha: 'platinum', uf: 'SP' }, 8: { estado: 'ok', nome: null, medalha: null, uf: 'RJ' }, 9: { estado: 'indisponivel' } };
    const cards = [card('A1', { catalogProductId: 'MLB1' }), card('A2', { catalogProductId: 'MLB1' }), card('A3', { catalogProductId: 'MLB1' }),
      card('B1', { catalogProductId: 'MLB2' }), card('B2', { catalogProductId: 'MLB2' }), card('C1', { catalogProductId: 'MLB3' }),
      card('D1', { catalogProductId: 'MLB4' }), card('E1')];
    const r = resumoEnriquecimento(cards, e);
    expect(r.cardsComCatalogo).toBe(7);
    expect(r.vendedores).toMatchObject({ unicos: 3, medalhas: { platinum: 1, gold: 0, silver: 0, sem: 0 }, medalhaDesconhecida: 2, ufs: [['RJ', 1], ['SP', 1]], ufOutros: 0, ufDesconhecida: 1, cardsSemVendedor: 3 });
    expect(r.tipos).toEqual({ classico: 3, premium: 1, desconhecido: 1, exatas: 5 });
    expect(r.faixas).toEqual({ ate5: 1, ate10: 0, ate30: 0, acima30: 1, semOfertas: 0, completos: 2, parciais: [12], catalogos: 4 });
  });

  it('Task 11.4: parcial terminal (429) mantém cobertura e desconhecidos; lidos, em consulta e indisponíveis à parte', () => {
    const e = enriquecimentoVazio();
    e.catalogos.MLB1 = { produto: { estado: 'ok', criadoEm: null }, ofertas: of(3, true, { A1: ex(7), A2: { estado: 'indisponivel', preco: 100, motivo: 'limite do Mercado Livre' } }) };
    e.catalogos.MLB2 = { produto: { estado: 'ok', criadoEm: null }, ofertas: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } };
    e.vendedores = { 7: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } };
    const cards = [card('A1', { catalogProductId: 'MLB1' }), card('A2', { catalogProductId: 'MLB1' }), card('B1', { catalogProductId: 'MLB2' }), card('C1', { catalogProductId: 'MLB3' })];
    const r = resumoEnriquecimento(cards, e);
    expect(r).toMatchObject({ cardsComCatalogo: 4, catalogosLidos: 1, catalogosConsultando: 1, catalogosIndisponiveis: 1 });
    // Vendedor com perfil indisponível: único, medalha/UF desconhecidas (nunca "sem medalha" nem zero).
    expect(r.vendedores).toMatchObject({ unicos: 1, medalhas: { platinum: 0, gold: 0, silver: 0, sem: 0 }, medalhaDesconhecida: 1, ufDesconhecida: 1, cardsSemVendedor: 3 });
    expect(r.tipos).toEqual({ classico: 1, premium: 0, desconhecido: 0, exatas: 1 });
  });

  it('UF: 5 maiores + outros; nada enriquecido = zeros sem inventar', () => {
    const e = enriquecimentoVazio();
    const exatas: Record<string, unknown> = {};
    const cards: CardBusca[] = [];
    ['SP', 'SP', 'RJ', 'MG', 'PR', 'SC', 'BA', 'GO'].forEach((uf, i) => { exatas[`I${i}`] = ex(i + 1); e.vendedores[String(i + 1)] = { estado: 'ok', nome: null, medalha: 'gold', uf }; cards.push(card(`I${i}`, { catalogProductId: 'MLB1' })); });
    e.catalogos.MLB1 = { ofertas: of(8, true, exatas) };
    const r = resumoEnriquecimento(cards, e);
    expect(r.vendedores.ufs).toEqual([['SP', 2], ['BA', 1], ['GO', 1], ['MG', 1], ['PR', 1]]);
    expect(r.vendedores.ufOutros).toBe(2);
    const vazio = resumoEnriquecimento(cards, enriquecimentoVazio());
    expect(vazio.vendedores.unicos).toBe(0);
    expect(vazio.faixas.completos).toBe(0);
  });
});

describe('participação nos pisos observados (fatia 2.1)', () => {
  it('maior piso por grupo (catálogo → /up/ → item) ÷ soma dos grupos; sem vendidos fora da soma e "—"; conflito fora; cobertura', () => {
    const r = participacaoNosPisos([
      card('MLB1', { catalogProductId: 'MLB100', vendidosTexto: '+1000 vendidos' }),
      card('MLB2', { catalogProductId: 'MLB100', vendidosTexto: '+500 vendidos' }), // mesmo catálogo: grupo único, maior piso
      card('MLB3', { vendidosTexto: '+500 vendidos' }),
      card('MLB4', { vendidosTexto: null }), // sem piso: fora do denominador
      card('MLB5', { userProductId: 'UP1', vendidosTexto: '+500 vendidos' }),
      card('MLB6', { userProductId: 'UP1', vendidosTexto: '+100 vendidos' }), // mesmo /up/
      card('MLB7', { identidadeConflitante: true, vendidosTexto: '+5mil vendidos' }), // conflito: fora
    ]);
    expect(r.porItem).toEqual({ MLB1: 0.5, MLB2: 0.5, MLB3: 0.25, MLB4: null, MLB5: 0.25, MLB6: 0.25, MLB7: null });
    expect(r).toMatchObject({ cobertura: 3, grupos: 4 });
  });

  it('patrocinado + orgânico do mesmo item não duplicam (um card agregado); soma zero = "—"', () => {
    const c = card('MLB1', { vendidosTexto: '+100 vendidos', ocorrencias: [{ posicao: 1, patrocinado: true, preco: 10, vendidosTexto: '+100 vendidos' }, { posicao: 9, patrocinado: false, preco: 12, vendidosTexto: '+100 vendidos' }] });
    expect(participacaoNosPisos([c, card('MLB2', { vendidosTexto: '+100 vendidos' })]).porItem).toEqual({ MLB1: 0.5, MLB2: 0.5 });
    expect(participacaoNosPisos([card('MLB1', { vendidosTexto: '0 vendidos' })]).porItem).toEqual({ MLB1: null });
  });

  it('card sem vendidos num grupo com piso mostra "—" (o grupo continua no denominador pelo piso do irmão)', () => {
    const r = participacaoNosPisos([
      card('MLB1', { catalogProductId: 'MLB100', vendidosTexto: '+100 vendidos' }),
      card('MLB2', { catalogProductId: 'MLB100', vendidosTexto: null }),
      card('MLB3', { vendidosTexto: '+100 vendidos' }),
    ]);
    expect(r.porItem).toEqual({ MLB1: 0.5, MLB2: null, MLB3: 0.5 });
  });

  it('base = todos os cards passados: filtro/ordem do painel não mudam o valor; scroll muda', () => {
    const base = [card('MLB1', { vendidosTexto: '+100 vendidos' }), card('MLB2', { vendidosTexto: '+100 vendidos' })];
    expect(participacaoNosPisos(base).porItem.MLB1).toBe(0.5);
    expect(participacaoNosPisos([...base, card('MLB3', { vendidosTexto: '+200 vendidos' })]).porItem.MLB1).toBe(0.25);
  });
});

describe('reputação no resumo do enriquecimento (fatia 2.1)', () => {
  it('por vendedor único, com desconhecidos explícitos', () => {
    const e = enriquecimentoVazio();
    const exata = (itemId: string, sellerId: number) => ({ [itemId]: { estado: 'ok' as const, preco: 100, sellerId, tipo: null, comissao: { estado: 'indisponivel' as const, motivo: 'x' } } });
    e.catalogos.MLB100 = { ofertas: { estado: 'ok', total: 3, lidas: 3, vendedoresIdentificados: 3, ofertasSemVendedor: 0, completa: true, exatas: { ...exata('MLB1', 7), ...exata('MLB2', 7), ...exata('MLB3', 8), ...exata('MLB4', 9) } } };
    e.vendedores['7'] = { estado: 'ok', nome: null, medalha: null, uf: null, reputacao: '5_green' };
    e.vendedores['8'] = { estado: 'ok', nome: null, medalha: null, uf: null, reputacao: null };
    const cs = ['MLB1', 'MLB2', 'MLB3', 'MLB4'].map((id) => card(id, { catalogProductId: 'MLB100' }));
    const v = resumoEnriquecimento(cs, e).vendedores;
    expect(v.unicos).toBe(3);
    expect(v.reputacoes).toEqual({ '5_green': 1, '4_light_green': 0, '3_yellow': 0, '2_orange': 0, '1_red': 0 });
    expect(v.reputacaoDesconhecida).toBe(2); // 8 sem reputação, 9 sem perfil
  });
});
