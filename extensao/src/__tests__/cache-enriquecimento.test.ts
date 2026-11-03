// Cache do enriquecimento no navegador e planejamento do lote (plano, Revisão 03/11, regras 2-3 e 10).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aplicarResposta, gravarCache, lerCache, planejarLote, type CacheEnr } from '../cache-enriquecimento';
import { enriquecimentoVazio, type EstadoEnriquecimento } from '../compartilhado/enriquecimento';
import { limparEstadosDasAbas } from '../abas';
import { instalarChromeFalso } from './chrome-falso';

const T0 = Date.parse('2026-11-03T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const card = (n: number, o: Record<string, unknown> = {}) =>
  ({ itemId: `MLB${1000000 + n}`, catalogProductId: 'MLB900', preco: 10, identidadeConflitante: false, ...o }) as never;
const vazioCache = (): CacheEnr => ({ identidade: 'u1:org1:', conta: null, produtos: {}, ofertas: {}, vendedores: {} });
const ofertasOk = (exatas: Record<string, unknown>) =>
  ({ estado: 'ok' as const, total: 3, lidas: 3, vendedoresIdentificados: 2, ofertasSemVendedor: 0, completa: true, exatas: exatas as never });

let sessao: Record<string, unknown>;
beforeEach(() => { sessao = instalarChromeFalso(); });

describe('planejarLote', () => {
  it('dez cards do mesmo catálogo → uma entrada, com os dez itens (preço do card), produto + ofertas', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(i));
    const p = planejarLote(cards, {}, enriquecimentoVazio(), vazioCache(), T0, new Set());
    expect(p.pedido!.catalogos).toEqual([{ catalogProductId: 'MLB900', componentes: ['produto', 'ofertas'], itens: cards.map((c: { itemId: string }) => ({ itemId: c.itemId, preco: 10 })) }]);
  });

  it('prioridade: próprio/vinculado primeiro, depois a ordem observada; ≤ 5 catálogos; sem catálogo, conflito e sem preço fora dos itens', () => {
    const cards = [
      card(1, { catalogProductId: 'MLB1' }), card(2, { catalogProductId: 'MLB2' }), card(3, { catalogProductId: null }),
      card(4, { catalogProductId: 'MLB4', identidadeConflitante: true }), card(5, { catalogProductId: 'MLB5', preco: null }),
      card(6, { catalogProductId: 'MLB6' }), card(7, { catalogProductId: 'MLB7' }), card(8, { catalogProductId: 'MLB8' }), card(9, { catalogProductId: 'MLB9' }),
    ];
    const meta = { MLB1000008: { proprio: true, vinculo: null }, MLB1000007: { proprio: false, vinculo: { fonte: 'catalogo', codigo: 'x' } } } as never;
    const p = planejarLote(cards, meta, enriquecimentoVazio(), vazioCache(), T0, new Set());
    expect(p.pedido!.catalogos.map((c) => c.catalogProductId)).toEqual(['MLB7', 'MLB8', 'MLB1', 'MLB2', 'MLB5']);
    expect(p.pedido!.catalogos.find((c) => c.catalogProductId === 'MLB5')!.itens).toEqual([]);
  });

  it('≤ 20 itens por catálogo e ≤ 50 itens no lote', () => {
    const cards = [1, 2, 3].flatMap((k) => Array.from({ length: 25 }, (_, i) => card(k * 100 + i, { catalogProductId: `MLB${k}` })));
    const p = planejarLote(cards, {}, enriquecimentoVazio(), vazioCache(), T0, new Set());
    expect(p.pedido!.catalogos.map((c) => c.itens.length)).toEqual([20, 20]);
  });

  it('cache válido cobre o item pedido: sem edge; item novo ou preço diferente = pede só as ofertas', () => {
    const cache = vazioCache();
    cache.produtos.MLB900 = { criadoEm: '2026-01-01T00:00:00Z', exp: T0 + 1000, u: 0 };
    cache.ofertas.MLB900 = { v: ofertasOk({ MLB1000001: { estado: 'ok', preco: 10, sellerId: 7, tipo: 'gold_special', comissao: { estado: 'aguardando' } } }), exp: T0 + 1000, u: 0 };
    cache.vendedores['7'] = { v: { estado: 'ok', nome: 'V7', medalha: 'gold', uf: 'SP' }, exp: T0 + 1000, u: 0 };
    const hit = planejarLote([card(1)], {}, enriquecimentoVazio(), cache, T0, new Set());
    expect(hit.pedido).toBeNull();
    expect(hit.hits.catalogos.MLB900).toMatchObject({ produto: { estado: 'ok' }, ofertas: { estado: 'ok' } });
    expect(hit.hits.vendedores['7']).toMatchObject({ estado: 'ok', medalha: 'gold' });
    const novo = planejarLote([card(1), card(2)], {}, enriquecimentoVazio(), cache, T0, new Set());
    expect(novo.pedido!.catalogos).toEqual([{ catalogProductId: 'MLB900', componentes: ['ofertas'], itens: [{ itemId: 'MLB1000001', preco: 10 }, { itemId: 'MLB1000002', preco: 10 }] }]);
    expect(novo.pedido!.perfisEmCache).toEqual([7]);
    const preco = planejarLote([card(1, { preco: 12 })], {}, enriquecimentoVazio(), cache, T0, new Set());
    expect(preco.pedido!.catalogos[0].componentes).toEqual(['ofertas']);
    // Expirado (exp ≤ agora) não cobre.
    expect(planejarLote([card(1)], {}, enriquecimentoVazio(), cache, T0 + 1000, new Set()).pedido!.catalogos[0].componentes).toEqual(['produto', 'ofertas']);
  });

  it('vista da aba já lida: cache expirado não refaz (busca parada não renova sozinha)', () => {
    const e = enriquecimentoVazio();
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk({ MLB1000001: { estado: 'nao_encontrada', preco: 10 } }) };
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
    e.catalogos.MLB900 = { produto: { estado: 'indisponivel' }, ofertas: { estado: 'indisponivel' } };
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
  });

  it('janela esgotada: nada pede até retomarEm (esperar); depois retoma o catálogo', () => {
    const e = enriquecimentoVazio();
    e.retomarEm = T0 + 30_000;
    e.catalogos.MLB900 = { aguardandoJanela: true };
    const antes = planejarLote([card(1)], {}, e, vazioCache(), T0, new Set());
    expect(antes).toMatchObject({ pedido: null, esperar: true });
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0 + 30_000, new Set()).pedido!.catalogos).toHaveLength(1);
  });

  it('componente aguardando (429, sem retomarEm): uma nova tentativa automática só', () => {
    const e = enriquecimentoVazio();
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: { estado: 'aguardando', retomarEm: null, tentativas: 1 } };
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido!.catalogos[0].componentes).toEqual(['ofertas']);
    e.catalogos.MLB900.ofertas = { estado: 'aguardando', retomarEm: null, tentativas: 2 };
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
  });

  it('perfis: ofertas lidas sem perfil → até 5 por pedido e 20 por busca; já pedido na rodada não repete', () => {
    const e = enriquecimentoVazio();
    const exatas = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`MLB${1000000 + i}`, { estado: 'ok', preco: 10, sellerId: 50 + i, tipo: null, comissao: { estado: 'aguardando' } }]));
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk(exatas) };
    const cards = Array.from({ length: 8 }, (_, i) => card(i));
    expect(planejarLote(cards, {}, e, vazioCache(), T0, new Set()).pedido).toEqual({ catalogos: [], perfis: [50, 51, 52, 53, 54], perfisEmCache: [] });
    e.perfis = 18;
    expect(planejarLote(cards, {}, e, vazioCache(), T0, new Set()).pedido!.perfis).toEqual([50, 51]);
    e.perfis = 20;
    expect(planejarLote(cards, {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
    e.perfis = 0;
    expect(planejarLote(cards, {}, e, vazioCache(), T0, new Set(['perfil:50', 'perfil:51'])).pedido!.perfis).toEqual([52, 53, 54, 55, 56]);
  });

  it('teto de perfis da busca atingido: vendedores conhecidos vão em perfisEmCache (a edge não os consulta)', () => {
    const e = enriquecimentoVazio();
    e.perfis = 20;
    e.vendedores['9'] = { estado: 'ok', nome: null, medalha: null, uf: null };
    const p = planejarLote([card(1, { catalogProductId: 'MLB1' })], {}, e, vazioCache(), T0, new Set());
    expect(p.pedido).toMatchObject({ perfis: [], perfisEmCache: [9] });
  });
});

describe('aplicarResposta', () => {
  const pedido = { catalogos: [{ catalogProductId: 'MLB900', componentes: ['produto', 'ofertas'] as ('produto' | 'ofertas')[], itens: [{ itemId: 'MLB1000001', preco: 10 }] }], perfis: [], perfisEmCache: [] };

  it('ok → vista e cache com a expiração do servidor; vendedores contam no teto', () => {
    const e: EstadoEnriquecimento = enriquecimentoVazio();
    const gravar = aplicarResposta(e, pedido, {
      consultadoEm: iso(T0),
      catalogos: [{ catalogProductId: 'MLB900', estado: 'ok', retomarEm: null, consultadoEm: iso(T0),
        produto: { estado: 'ok', criadoEm: '2025-01-01T00:00:00Z', expiraEm: iso(T0 + 6 * 3600_000) },
        ofertas: { estado: 'ok', expiraEm: iso(T0 + 60_000), total: 4, lidas: 4, vendedoresIdentificados: 3, ofertasSemVendedor: 0, completa: true,
          exatas: [{ itemId: 'MLB1000001', estado: 'ok', categoriaId: 'MLB5', sellerId: 7, tipo: 'gold_pro', perfil: 'carregado', comissaoNaSuaConta: { estado: 'ok', valor: { percentual: 16, fixa: 0 } } }] } }],
      vendedores: [{ sellerId: 7, estado: 'ok', nome: 'V7', medalha: 'platinum', uf: 'SP', expiraEm: iso(T0 + 24 * 3600_000) }, { sellerId: 8, estado: 'indisponivel', motivo: 'perfil indisponível' }],
      custo: { comandosRedis: 1, chamadasMl: 1 },
    }, T0);
    expect(e.catalogos.MLB900.ofertas).toMatchObject({ estado: 'ok', exatas: { MLB1000001: { estado: 'ok', preco: 10, sellerId: 7, tipo: 'gold_pro', comissao: { estado: 'ok' } } } });
    expect(e.vendedores['7']).toEqual({ estado: 'ok', nome: 'V7', medalha: 'platinum', uf: 'SP' });
    expect(e.perfis).toBe(2);
    const c = vazioCache();
    gravar(c);
    expect(c.produtos.MLB900.exp).toBe(T0 + 6 * 3600_000);
    expect(c.ofertas.MLB900.exp).toBe(T0 + 60_000);
    expect(c.vendedores['7'].exp).toBe(T0 + 24 * 3600_000);
    expect(c.vendedores['8']).toBeUndefined(); // só ok vai ao cache
  });

  it('cota esgotada → aguardandoJanela + retomarEm; limite de perfis por pedido não conta tentativa', () => {
    const e = enriquecimentoVazio();
    aplicarResposta(e, pedido, {
      consultadoEm: iso(T0), catalogos: [{ catalogProductId: 'MLB900', estado: 'aguardando', retomarEm: iso(T0 + 40_000), consultadoEm: null }],
      vendedores: [{ sellerId: 3, estado: 'aguardando', retomarEm: null, motivo: 'limite de perfis por pedido' }], custo: { comandosRedis: 0, chamadasMl: 0 },
    }, T0);
    expect(e.catalogos.MLB900).toEqual({ aguardandoJanela: true });
    expect(e.retomarEm).toBe(T0 + 40_000);
    expect(e.vendedores['3']).toEqual({ estado: 'aguardando', retomarEm: null, tentativas: 0 });
    expect(e.perfis).toBe(0);
  });
});

describe('cache no chrome.storage.session', () => {
  it('por identidade: outra identidade lê vazio; expirado some na leitura', async () => {
    await gravarCache('u1:org1:', (c) => { c.produtos.MLB1 = { criadoEm: null, exp: T0 + 10, u: T0 }; c.produtos.MLB2 = { criadoEm: null, exp: T0 - 1, u: T0 }; }, T0);
    expect(Object.keys((await lerCache('u1:org1:', T0)).produtos)).toEqual(['MLB1']);
    expect((await lerCache('u1:org2:', T0)).produtos).toEqual({});
    await gravarCache('u1:org2:', (c) => { c.produtos.MLB3 = { criadoEm: null, exp: T0 + 10, u: T0 }; }, T0);
    expect((await lerCache('u1:org1:', T0)).produtos).toEqual({}); // a outra identidade substituiu tudo
  });

  it('passa de ~5 MiB → remove os menos usados; expirados saem na gravação', async () => {
    const grande = 'x'.repeat(200_000);
    await gravarCache('u1:org1:', (c) => {
      for (let i = 0; i < 30; i++) c.produtos[`MLB${i}`] = { criadoEm: grande, exp: T0 + 10_000, u: T0 + i };
    }, T0);
    const c = await lerCache('u1:org1:', T0);
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(c.produtos.MLB0).toBeUndefined(); // menos usado
    expect(c.produtos.MLB29).toBeDefined();
  });

  it('falha de gravação/leitura = segue sem cache', async () => {
    vi.mocked(chrome.storage.session.set).mockRejectedValueOnce(new Error('QUOTA_BYTES'));
    await expect(gravarCache('u1:org1:', (c) => { c.produtos.MLB1 = { criadoEm: null, exp: T0 + 10, u: T0 }; }, T0)).resolves.toBeUndefined();
    vi.mocked(chrome.storage.session.get).mockRejectedValueOnce(new Error('x'));
    expect((await lerCache('u1:org1:', T0)).produtos).toEqual({});
  });

  it('limparEstadosDasAbas (saída, troca de identidade/suporte, sessão inválida) apaga o cache', async () => {
    await gravarCache('u1:org1:', (c) => { c.produtos.MLB1 = { criadoEm: null, exp: T0 + 10, u: T0 }; }, T0);
    expect(Object.keys(sessao).some((k) => k.startsWith('enr:'))).toBe(true);
    await limparEstadosDasAbas();
    expect(Object.keys(sessao).some((k) => k.startsWith('enr:'))).toBe(false);
  });
});
