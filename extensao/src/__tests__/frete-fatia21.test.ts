// Fatia 2.1 (marca, cidade, reputação, frete): cache por componente, planejamento, resposta e "Tentar novamente".
import { beforeEach, describe, expect, it } from 'vitest';
import {
  aplicarHits, aplicarResposta, corpoDoPedido, gravarCache, lerCache, marcarFalha, marcasDoPedido, planejarLote, prepararNovaTentativa, semDados, type CacheEnr, type PedidoLote,
} from '../cache-enriquecimento';
import { chaveFrete, enriquecimentoVazio, esperaDaNovaTentativa, haParaTentar, vistaDoFrete, type EstadoEnriquecimento } from '../compartilhado/enriquecimento';
import { instalarChromeFalso } from './chrome-falso';

const T0 = Date.parse('2026-11-03T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const card = (n: number, o: Record<string, unknown> = {}) =>
  ({ itemId: `MLB${1000000 + n}`, catalogProductId: null, preco: 10, identidadeConflitante: false, ...o }) as never;
const cacheVazio = (): CacheEnr => ({ versao: 2, identidade: 'u1:org1:', conta: 'c1', produtos: {}, ofertas: {}, vendedores: {}, fretes: {} });
const K = (n: number, preco = 10) => chaveFrete(`MLB${1000000 + n}`, preco);
const resposta = (o: Record<string, unknown> = {}) => ({ consultadoEm: iso(T0), catalogos: [], vendedores: [], custo: { comandosRedis: 1, chamadasMl: 1 }, tentarAposEm: null, ...o }) as never;
const freteOk = (n: number, valor: number, preco = 10) => ({ itemId: `MLB${1000000 + n}`, preco, frete: { estado: 'ok', valor }, expiraEm: iso(T0 + 6 * 3600_000) });

beforeEach(() => { instalarChromeFalso(); });

describe('planejamento do frete', () => {
  it('qualquer card com preço (catálogo ou não), pelo item e preço do card; conflito e sem preço fora; ≤ 50 por pedido', () => {
    const cards = [card(1), card(2, { catalogProductId: 'MLB9' }), card(3, { identidadeConflitante: true }), card(4, { preco: null }), card(1)];
    const p = planejarLote(cards, {}, enriquecimentoVazio(), cacheVazio(), T0, new Set()).pedido!;
    expect(p.fretes).toEqual([{ itemId: 'MLB1000001', preco: 10 }, { itemId: 'MLB1000002', preco: 10 }]);
    const muitos = Array.from({ length: 60 }, (_, i) => card(i));
    const ja = new Set<string>();
    const p1 = planejarLote(muitos, {}, enriquecimentoVazio(), cacheVazio(), T0, ja).pedido!;
    expect(p1.fretes).toHaveLength(50);
    for (const m of marcasDoPedido(p1)) ja.add(m);
    expect(planejarLote(muitos, {}, enriquecimentoVazio(), cacheVazio(), T0, ja).pedido!.fretes).toHaveLength(10);
  });

  it('frete válido no cache: hit sem pedido; vencido vai sozinho; preço diferente não herda; ofertas vencidas não recotam frete', () => {
    const c = cacheVazio();
    c.fretes[K(1)] = { v: 23.45, exp: T0 + 1000, u: 0 };
    const hit = planejarLote([card(1)], {}, enriquecimentoVazio(), c, T0, new Set());
    expect(hit.pedido).toBeNull();
    const e = enriquecimentoVazio();
    aplicarHits(e, hit.hits);
    expect(e.fretes![K(1)]).toEqual({ estado: 'ok', valor: 23.45 });
    // Vencido (6 h): pedido só de frete (nada mais vencido).
    expect(planejarLote([card(1)], {}, enriquecimentoVazio(), c, T0 + 1000, new Set()).pedido).toEqual({ catalogos: [], perfis: [], perfisEmCache: [], fretes: [{ itemId: 'MLB1000001', preco: 10 }] });
    // Outro preço: outra chave.
    expect(planejarLote([card(1, { preco: 11 })], {}, enriquecimentoVazio(), c, T0, new Set()).pedido!.fretes).toEqual([{ itemId: 'MLB1000001', preco: 11 }]);
    // Ofertas do catálogo vencidas (60 s) com frete válido: só as ofertas vão.
    c.produtos.MLB9 = { criadoEm: null, marca: 'Natura', exp: T0 + 1000, u: 0 };
    const p = planejarLote([card(1, { catalogProductId: 'MLB9' })], {}, enriquecimentoVazio(), c, T0, new Set()).pedido!;
    expect(p.catalogos).toEqual([{ catalogProductId: 'MLB9', componentes: ['ofertas'], itens: [{ itemId: 'MLB1000001', preco: 10 }] }]);
    expect(p.fretes).toEqual([]);
    expect(planejarLote([card(1, { catalogProductId: 'MLB9' })], {}, enriquecimentoVazio(), c, T0, new Set()).hits.catalogos.MLB9.produto).toEqual({ estado: 'ok', criadoEm: null, marca: 'Natura' });
  });

  it('compatibilidade: sem frete a pedir, o corpo é o da 0.5.0 (sem a chave `fretes`)', () => {
    const p: PedidoLote = { catalogos: [{ catalogProductId: 'MLB9', componentes: ['produto'], itens: [] }], perfis: [], perfisEmCache: [], fretes: [] };
    expect(Object.keys(corpoDoPedido(p))).toEqual(['catalogos', 'perfis', 'perfisEmCache']);
    expect(corpoDoPedido({ ...p, fretes: [{ itemId: 'MLB1', preco: 5 }] })).toMatchObject({ fretes: [{ itemId: 'MLB1', preco: 5 }] });
  });

  it('semDados (conta não confirmada/trocada) esvazia o frete junto', () => {
    const c = cacheVazio();
    c.fretes[K(1)] = { v: 1, exp: T0 + 1000, u: 0 };
    expect(semDados(c).fretes).toEqual({});
  });
});

describe('resposta do frete', () => {
  const pedido: PedidoLote = { catalogos: [], perfis: [], perfisEmCache: [], fretes: [{ itemId: 'MLB1000001', preco: 10 }, { itemId: 'MLB1000002', preco: 10 }, { itemId: 'MLB1000003', preco: 10 }] };

  it('ok → vista e cache (expiração do servidor); indisponível nunca vira zero nem vai ao cache; pedido sem resposta (edge antiga) = terminal', () => {
    const e = enriquecimentoVazio();
    const gravar = aplicarResposta(e, pedido, resposta({ fretes: [freteOk(1, 0), { itemId: 'MLB1000002', preco: 10, frete: { estado: 'indisponivel', motivo: 'frete da oferta indisponível' }, expiraEm: null }] }), T0);
    expect(e.fretes).toEqual({
      [K(1)]: { estado: 'ok', valor: 0 },
      [K(2)]: { estado: 'indisponivel', motivo: 'frete da oferta indisponível' },
      [K(3)]: { estado: 'indisponivel', motivo: 'frete indisponível' },
    });
    const c = cacheVazio();
    gravar(c);
    expect(c.fretes).toEqual({ [K(1)]: { v: 0, exp: T0 + 6 * 3600_000, u: T0 } });
    expect(planejarLote([card(1), card(2), card(3)], {}, e, cacheVazio(), T0, new Set()).pedido).toBeNull(); // terminal
    expect(vistaDoFrete(card(2), 10, e)).toEqual({ estado: 'indisponivel', motivo: 'frete da oferta indisponível' });
    expect(vistaDoFrete(card(4), 10, e)).toBe('consultando');
    expect(vistaDoFrete(card(1), 11, e)).toBe('consultando'); // outro preço não herda
    expect(vistaDoFrete(card(1), null, e)).toBeNull();
  });

  it('entrada de outro item/preço não pedido é ignorada; ok sem expiraEm não vai ao cache', () => {
    const e = enriquecimentoVazio();
    const gravar = aplicarResposta(e, pedido, resposta({ fretes: [freteOk(1, 9, 99), { ...freteOk(2, 7), expiraEm: null }, freteOk(8, 5)] }), T0);
    expect(e.fretes![K(1)]).toEqual({ estado: 'indisponivel', motivo: 'frete indisponível' });
    expect(e.fretes![K(2)]).toEqual({ estado: 'ok', valor: 7 });
    expect(e.fretes![K(8)]).toBeUndefined();
    const c = cacheVazio();
    gravar(c);
    expect(c.fretes).toEqual({});
  });

  it('marca, cidade e reputação: válidos copiados; ausentes ou inválidos = null', () => {
    const e = enriquecimentoVazio();
    const p: PedidoLote = { catalogos: [{ catalogProductId: 'MLB9', componentes: ['produto'], itens: [] }, { catalogProductId: 'MLB8', componentes: ['produto'], itens: [] }], perfis: [7, 8], perfisEmCache: [] };
    const gravar = aplicarResposta(e, p, resposta({
      catalogos: [
        { catalogProductId: 'MLB9', estado: 'ok', retomarEm: null, consultadoEm: iso(T0), produto: { estado: 'ok', criadoEm: null, marca: ' Natura ', expiraEm: iso(T0 + 1000) } },
        { catalogProductId: 'MLB8', estado: 'ok', retomarEm: null, consultadoEm: iso(T0), produto: { estado: 'ok', criadoEm: null, expiraEm: iso(T0 + 1000) } },
      ],
      vendedores: [
        { sellerId: 7, estado: 'ok', nome: 'A', medalha: null, uf: 'SP', cidade: 'Campinas', reputacao: '4_light_green', expiraEm: iso(T0 + 1000) },
        { sellerId: 8, estado: 'ok', nome: 'B', medalha: null, uf: null, cidade: '  ', reputacao: '6_blue', expiraEm: iso(T0 + 1000) },
      ],
    }), T0);
    expect(e.catalogos.MLB9.produto).toEqual({ estado: 'ok', criadoEm: null, marca: 'Natura' });
    expect(e.catalogos.MLB8.produto).toEqual({ estado: 'ok', criadoEm: null, marca: null });
    expect(e.vendedores['7']).toMatchObject({ cidade: 'Campinas', reputacao: '4_light_green' });
    expect(e.vendedores['8']).toMatchObject({ cidade: null, reputacao: null });
    const c = cacheVazio();
    gravar(c);
    expect(c.produtos.MLB9.marca).toBe('Natura');
    expect(c.vendedores['7'].v).toMatchObject({ cidade: 'Campinas', reputacao: '4_light_green' });
  });
});

describe('falha e "Tentar novamente" com frete', () => {
  it('rodada sem resposta: fretes pedidos ficam terminais e o planejamento para (sem laço)', () => {
    const e = enriquecimentoVazio();
    const cards = Array.from({ length: 60 }, (_, i) => card(i));
    const ja = new Set<string>();
    let voltas = 0;
    for (let p = planejarLote(cards, {}, e, cacheVazio(), T0, ja).pedido; p; p = planejarLote(cards, {}, e, cacheVazio(), T0, ja).pedido) {
      for (const m of marcasDoPedido(p)) ja.add(m);
      marcarFalha(e, p, 'falha de rede');
      if (++voltas > 3) throw new Error('laço');
    }
    expect(voltas).toBe(2);
    expect(Object.values(e.fretes!).every((f) => f.estado === 'indisponivel')).toBe(true);
    // Sem as marcas da rodada (rodada seguinte), também nada: a vista já é terminal.
    expect(planejarLote(cards, {}, e, cacheVazio(), T0, new Set()).pedido).toBeNull();
  });

  it('429 só do frete: a pausa segura só os fretes; o catálogo com tempo esgotado é refeito já', () => {
    const e = enriquecimentoVazio();
    const p: PedidoLote = { catalogos: [{ catalogProductId: 'MLB9', componentes: ['produto'], itens: [] }], perfis: [], perfisEmCache: [], fretes: [{ itemId: 'MLB1000001', preco: 10 }] };
    aplicarResposta(e, p, resposta({
      tentarAposEm: iso(T0 + 120_000),
      catalogos: [{ catalogProductId: 'MLB9', estado: 'ok', retomarEm: null, consultadoEm: iso(T0), produto: { estado: 'indisponivel', motivo: 'tempo esgotado' } }],
      fretes: [{ itemId: 'MLB1000001', preco: 10, frete: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' }, expiraEm: null }],
    }), T0);
    expect(e.tentarAposEm).toBeNull();
    expect(e.freteAposEm).toBe(T0 + 120_000);
    expect(esperaDaNovaTentativa(e, T0)).toBeNull(); // há o catálogo para refazer
    expect(prepararNovaTentativa(e, T0)).toBe(true);
    expect(e.catalogos.MLB9).toEqual({});
    expect(e.fretes![K(1)]).toEqual({ estado: 'indisponivel', motivo: 'limite do Mercado Livre' }); // ainda na pausa
    // Só o frete por refazer, na pausa: recusa com a hora; depois dela, refaz.
    expect(esperaDaNovaTentativa(e, T0)).toBe(T0 + 120_000);
    expect(prepararNovaTentativa(e, T0)).toBe(false);
    expect(prepararNovaTentativa(e, T0 + 120_001)).toBe(true);
    expect(e.fretes).toEqual({});
    expect(e.freteAposEm).toBeNull();
  });

  it('429 do catálogo junto: o Retry-After vale para tudo (como antes)', () => {
    const e = enriquecimentoVazio();
    const p: PedidoLote = { catalogos: [{ catalogProductId: 'MLB9', componentes: ['produto'], itens: [] }], perfis: [], perfisEmCache: [], fretes: [{ itemId: 'MLB1000001', preco: 10 }] };
    aplicarResposta(e, p, resposta({
      tentarAposEm: iso(T0 + 60_000),
      catalogos: [{ catalogProductId: 'MLB9', estado: 'ok', retomarEm: null, consultadoEm: iso(T0), produto: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } }],
      fretes: [{ itemId: 'MLB1000001', preco: 10, frete: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' }, expiraEm: null }],
    }), T0);
    expect(e.tentarAposEm).toBe(T0 + 60_000);
    expect(prepararNovaTentativa(e, T0)).toBe(false);
  });

  it('sem opção de envio é definitivo: não acende o "Tentar novamente" nem é apagado por ele', () => {
    const e: EstadoEnriquecimento = { ...enriquecimentoVazio(), fretes: { [K(1)]: { estado: 'indisponivel', motivo: 'frete da oferta indisponível' } } };
    expect(haParaTentar(e)).toBe(false);
    e.fretes![K(2)] = { estado: 'indisponivel', motivo: 'tempo esgotado' };
    expect(haParaTentar(e)).toBe(true);
    prepararNovaTentativa(e, T0);
    expect(Object.keys(e.fretes!)).toEqual([K(1)]);
    expect(haParaTentar(e)).toBe(false);
  });
});

describe('cache do frete no storage', () => {
  it('versão anterior do cache (sem frete) é descartada; frete vencido sai na leitura', async () => {
    await chrome.storage.session.set({ 'enr:cache': { identidade: 'u1:org1:', conta: 'c1', produtos: { MLB9: { criadoEm: null, exp: T0 + 9e9, u: 0 } }, ofertas: {}, vendedores: {} } });
    expect((await lerCache('u1:org1:', T0)).produtos).toEqual({});
    await gravarCache('u1:org1:', (c) => { c.fretes[K(1)] = { v: 5, exp: T0 + 1000, u: T0 }; c.fretes[K(2)] = { v: 6, exp: T0 + 5000, u: T0 }; }, T0);
    expect(Object.keys((await lerCache('u1:org1:', T0 + 2000)).fretes)).toEqual([K(2)]);
    expect((await lerCache('outra', T0)).fretes).toEqual({});
  });
});
