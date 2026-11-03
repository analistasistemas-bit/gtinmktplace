// Cache do enriquecimento no navegador e planejamento da página (Revisão 03/11-b: lote por página, Task 11.3).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aplicarResposta, gravarCache, haParaTentar, lerCache, marcarFalha, marcasDoPedido, planejarLote, prepararNovaTentativa, type CacheEnr } from '../cache-enriquecimento';
import { enriquecimentoVazio, vistaDoCard, type EstadoEnriquecimento } from '../compartilhado/enriquecimento';
import { limparEstadosDasAbas } from '../abas';
import { sair } from '../credenciais';
import { instalarChromeFalso, logar } from './chrome-falso';

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
  const ok = (c: { catalogProductId: string; componentes: string[]; itens: { itemId: string; preco: number }[] }, exatas: { itemId: string }[] = c.itens) =>
    ({ catalogProductId: c.catalogProductId, estado: 'ok' as const, retomarEm: null, consultadoEm: iso(T0),
      ...(c.componentes.includes('produto') ? { produto: { estado: 'ok' as const, criadoEm: null, expiraEm: iso(T0 + 1000) } } : {}),
      ...(c.componentes.includes('ofertas') ? { ofertas: { estado: 'ok' as const, expiraEm: iso(T0 + 1000), total: 30, lidas: 30, vendedoresIdentificados: 30, ofertasSemVendedor: 0, completa: true,
        exatas: exatas.map((i) => ({ itemId: i.itemId, estado: 'nao_encontrada' as const, motivo: 'x' })) } } : {}) });
  const resposta = (catalogos: unknown[], vendedores: unknown[] = []) => ({ consultadoEm: iso(T0), catalogos, vendedores, custo: { comandosRedis: 0, chamadasMl: 0 }, tentarAposEm: null }) as never;

  it('dez cards do mesmo catálogo → uma entrada, com os dez itens (preço do card), produto + ofertas', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(i));
    const p = planejarLote(cards, {}, enriquecimentoVazio(), vazioCache(), T0, new Set());
    expect(p.pedido!.catalogos).toEqual([{ catalogProductId: 'MLB900', componentes: ['produto', 'ofertas'], itens: cards.map((c: { itemId: string }) => ({ itemId: c.itemId, preco: 10 })) }]);
  });

  it('página inteira: 50 catálogos → UM pedido com os 50 (sem saldo de perfis da busca)', () => {
    const cards = Array.from({ length: 50 }, (_, i) => card(i, { catalogProductId: `MLB${i + 1}` }));
    const p = planejarLote(cards, {}, enriquecimentoVazio(), vazioCache(), T0, new Set());
    expect(p.pedido!.catalogos).toHaveLength(50);
    expect(p.pedido!.catalogos.reduce((n, c) => n + c.itens.length, 0)).toBe(50);
    expect(p.pedido).not.toHaveProperty('perfisRestantes');
  });

  it('prioridade: próprio/vinculado primeiro, depois a ordem observada; sem catálogo, conflito e sem preço fora dos itens', () => {
    const cards = [
      card(1, { catalogProductId: 'MLB1' }), card(2, { catalogProductId: 'MLB2' }), card(3, { catalogProductId: null }),
      card(4, { catalogProductId: 'MLB4', identidadeConflitante: true }), card(5, { catalogProductId: 'MLB5', preco: null }),
      card(6, { catalogProductId: 'MLB6' }), card(7, { catalogProductId: 'MLB7' }), card(8, { catalogProductId: 'MLB8' }),
    ];
    const meta = { MLB1000008: { proprio: true, vinculo: null }, MLB1000007: { proprio: false, vinculo: { fonte: 'catalogo', codigo: 'x' } } } as never;
    const p = planejarLote(cards, meta, enriquecimentoVazio(), vazioCache(), T0, new Set());
    expect(p.pedido!.catalogos.map((c) => c.catalogProductId)).toEqual(['MLB7', 'MLB8', 'MLB1', 'MLB2', 'MLB5', 'MLB6']);
    expect(p.pedido!.catalogos.find((c) => c.catalogProductId === 'MLB5')!.itens).toEqual([]);
  });

  it('≤ 50 itens no pedido e por catálogo; o excedente vai no pedido seguinte da rodada, que junta as ofertas exatas', () => {
    const cards = Array.from({ length: 60 }, (_, i) => card(i));
    const e = enriquecimentoVazio();
    const ja = new Set<string>();
    const p1 = planejarLote(cards, {}, e, vazioCache(), T0, ja).pedido!;
    expect(p1.catalogos[0].itens.map((i) => i.itemId)).toEqual(cards.slice(0, 50).map((c: { itemId: string }) => c.itemId));
    for (const m of marcasDoPedido(p1)) ja.add(m);
    aplicarResposta(e, p1, resposta([ok(p1.catalogos[0])]), T0);
    const p2 = planejarLote(cards, {}, e, vazioCache(), T0, ja).pedido!;
    expect(p2.catalogos).toEqual([{ catalogProductId: 'MLB900', componentes: ['ofertas'], itens: cards.slice(50).map((c: { itemId: string }) => ({ itemId: c.itemId, preco: 10 })) }]);
    for (const m of marcasDoPedido(p2)) ja.add(m);
    aplicarResposta(e, p2, resposta([ok(p2.catalogos[0])]), T0);
    expect(Object.keys((e.catalogos.MLB900.ofertas as { exatas: object }).exatas)).toHaveLength(60);
    expect(planejarLote(cards, {}, e, vazioCache(), T0, ja).pedido).toBeNull();
    // Dois catálogos de 30: o segundo não cabe nos 50 itens do primeiro pedido.
    const dois = [1, 2].flatMap((k) => Array.from({ length: 30 }, (_, i) => card(k * 100 + i, { catalogProductId: `MLB${k}` })));
    expect(planejarLote(dois, {}, enriquecimentoVazio(), vazioCache(), T0, new Set()).pedido!.catalogos.map((c) => c.itens.length)).toEqual([30]);
  });

  it('cache totalmente válido = zero pedidos; parcial = só os componentes vencidos', () => {
    const cache = vazioCache();
    cache.produtos.MLB900 = { criadoEm: '2026-01-01T00:00:00Z', exp: T0 + 1000, u: 0 };
    cache.ofertas.MLB900 = { v: ofertasOk({ MLB1000001: { estado: 'ok', preco: 10, sellerId: 7, tipo: 'gold_special', comissao: { estado: 'ok', valor: { percentual: 14, fixa: 0 } } } }), exp: T0 + 1000, u: 0 };
    cache.vendedores['7'] = { v: { estado: 'ok', nome: 'V7', medalha: 'gold', uf: 'SP' }, exp: T0 + 1000, u: 0 };
    const hit = planejarLote([card(1)], {}, enriquecimentoVazio(), cache, T0, new Set());
    expect(hit.pedido).toBeNull();
    expect(hit.hits.catalogos.MLB900).toMatchObject({ produto: { estado: 'ok' }, ofertas: { estado: 'ok' } });
    expect(hit.hits.vendedores['7']).toMatchObject({ estado: 'ok', medalha: 'gold' });
    // Produto válido, ofertas vencidas: só ofertas.
    const soOfertas = { ...cache, ofertas: { MLB900: { ...cache.ofertas.MLB900, exp: T0 - 1 } } };
    expect(planejarLote([card(1)], {}, enriquecimentoVazio(), soOfertas, T0, new Set()).pedido!.catalogos).toEqual([{ catalogProductId: 'MLB900', componentes: ['ofertas'], itens: [{ itemId: 'MLB1000001', preco: 10 }] }]);
    const novo = planejarLote([card(1), card(2)], {}, enriquecimentoVazio(), cache, T0, new Set());
    expect(novo.pedido!.catalogos).toEqual([{ catalogProductId: 'MLB900', componentes: ['ofertas'], itens: [{ itemId: 'MLB1000001', preco: 10 }, { itemId: 'MLB1000002', preco: 10 }] }]);
    expect(novo.pedido!.perfisEmCache).toEqual([7]);
    const preco = planejarLote([card(1, { preco: 12 })], {}, enriquecimentoVazio(), cache, T0, new Set());
    expect(preco.pedido!.catalogos[0].componentes).toEqual(['ofertas']);
    expect(planejarLote([card(1)], {}, enriquecimentoVazio(), cache, T0 + 1000, new Set()).pedido!.catalogos[0].componentes).toEqual(['produto', 'ofertas']);
  });

  it('vista da aba já lida ou indisponível (terminal): nada pedido — nem cache expirado nem indisponível se repetem sozinhos', () => {
    const e = enriquecimentoVazio();
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk({ MLB1000001: { estado: 'nao_encontrada', preco: 10 } }) };
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
    e.catalogos.MLB900 = { produto: { estado: 'indisponivel', motivo: 'tempo esgotado' }, ofertas: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } };
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk({ MLB1000001: { estado: 'indisponivel', preco: 10, motivo: 'tempo esgotado' } }) };
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
  });

  it('estado "aguardando" gravado por versão anterior: pedido de novo (uma vez por rodada)', () => {
    const e = enriquecimentoVazio();
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: { estado: 'aguardando', retomarEm: null, tentativas: 2 } };
    const p = planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido!;
    expect(p.catalogos[0].componentes).toEqual(['ofertas']);
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set(marcasDoPedido(p))).pedido).toBeNull();
  });

  it('perfis: vendedores das ofertas já lidas, até 50 por pedido, sem teto por busca; já pedido na rodada não repete', () => {
    const e = enriquecimentoVazio();
    const exatas = Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`MLB${1000000 + i}`, { estado: 'ok', preco: 10, sellerId: 50 + i, tipo: null, comissao: { estado: 'ok', valor: { percentual: 1, fixa: 0 } } }]));
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk(exatas) };
    const cards = Array.from({ length: 55 }, (_, i) => card(i));
    const p = planejarLote(cards, {}, e, vazioCache(), T0, new Set()).pedido!;
    expect(p).toEqual({ catalogos: [], perfis: Array.from({ length: 50 }, (_, i) => 50 + i), perfisEmCache: [] });
    expect(planejarLote(cards, {}, e, vazioCache(), T0, new Set(marcasDoPedido(p))).pedido!.perfis).toEqual([100, 101, 102, 103, 104]);
    e.vendedores['50'] = { estado: 'indisponivel', motivo: 'limite do Mercado Livre' }; // terminal: não volta
    expect(planejarLote(cards, {}, e, vazioCache(), T0, new Set()).pedido!.perfis[0]).toBe(51);
  });
});

describe('aplicarResposta', () => {
  const pedido = { catalogos: [{ catalogProductId: 'MLB900', componentes: ['produto', 'ofertas'] as ('produto' | 'ofertas')[], itens: [{ itemId: 'MLB1000001', preco: 10 }] }], perfis: [9], perfisEmCache: [] };
  const exata = (comissao: unknown) => ({ itemId: 'MLB1000001', estado: 'ok', categoriaId: 'MLB5', sellerId: 7, tipo: 'gold_pro', perfil: 'carregado', comissaoNaSuaConta: comissao });
  const comOfertas = (exatas: unknown[], o: Record<string, unknown> = {}) => ({
    consultadoEm: iso(T0), tentarAposEm: null, custo: { comandosRedis: 1, chamadasMl: 1 }, vendedores: [],
    catalogos: [{ catalogProductId: 'MLB900', estado: 'ok', retomarEm: null, consultadoEm: iso(T0),
      produto: { estado: 'ok', criadoEm: '2025-01-01T00:00:00Z', expiraEm: iso(T0 + 6 * 3600_000) },
      ofertas: { estado: 'ok', expiraEm: iso(T0 + 60_000), total: 4, lidas: 4, vendedoresIdentificados: 3, ofertasSemVendedor: 0, completa: true, exatas } }], ...o }) as never;

  it('ok → vista e cache com a expiração do servidor; vendedor indisponível guarda o motivo e não vai ao cache', () => {
    const e: EstadoEnriquecimento = enriquecimentoVazio();
    const gravar = aplicarResposta(e, pedido, comOfertas([exata({ estado: 'ok', valor: { percentual: 16, fixa: 0 } })], {
      vendedores: [{ sellerId: 7, estado: 'ok', nome: 'V7', medalha: 'platinum', uf: 'SP', expiraEm: iso(T0 + 24 * 3600_000) }, { sellerId: 9, estado: 'indisponivel', motivo: 'limite de perfis por pedido' }],
    }), T0);
    expect(e.catalogos.MLB900.ofertas).toMatchObject({ estado: 'ok', exatas: { MLB1000001: { estado: 'ok', preco: 10, sellerId: 7, tipo: 'gold_pro', comissao: { estado: 'ok' } } } });
    expect(e.vendedores['7']).toEqual({ estado: 'ok', nome: 'V7', medalha: 'platinum', uf: 'SP' });
    expect(e.vendedores['9']).toEqual({ estado: 'indisponivel', motivo: 'limite de perfis por pedido' });
    const c = vazioCache();
    gravar(c);
    expect(c.produtos.MLB900.exp).toBe(T0 + 6 * 3600_000);
    expect(c.ofertas.MLB900.exp).toBe(T0 + 60_000);
    expect(c.vendedores['7'].exp).toBe(T0 + 24 * 3600_000);
    expect(c.vendedores['9']).toBeUndefined();
  });

  it('só a comissão falhou: a vista mostra o motivo; o cache não guarda a oferta exata sem comissão como válida', () => {
    const e = enriquecimentoVazio();
    const gravar = aplicarResposta(e, pedido, comOfertas([exata({ estado: 'indisponivel', motivo: 'limite do Mercado Livre' })]), T0);
    expect((e.catalogos.MLB900.ofertas as { exatas: Record<string, unknown> }).exatas.MLB1000001).toMatchObject({ comissao: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } });
    const c = vazioCache();
    gravar(c);
    expect(c.ofertas.MLB900.v.exatas).toEqual({});
    // Outra busca com o mesmo card: o cache não cobre → pede as ofertas de novo.
    expect(planejarLote([card(1)], {}, enriquecimentoVazio(), c, T0, new Set()).pedido!.catalogos[0].componentes).toEqual(['ofertas']);
  });

  it('catálogo recusado (cota de páginas): componentes pedidos ficam indisponíveis com o motivo; Retry-After guardado', () => {
    const e = enriquecimentoVazio();
    const gravar = aplicarResposta(e, pedido, { consultadoEm: iso(T0), custo: { comandosRedis: 1, chamadasMl: 0 }, tentarAposEm: iso(T0 + 30_000),
      catalogos: [{ catalogProductId: 'MLB900', estado: 'indisponivel', motivo: 'limite de páginas por minuto', retomarEm: null, consultadoEm: null }],
      vendedores: [{ sellerId: 9, estado: 'indisponivel', motivo: 'limite de páginas por minuto' }] } as never, T0);
    expect(e.catalogos.MLB900).toEqual({ produto: { estado: 'indisponivel', motivo: 'limite de páginas por minuto' }, ofertas: { estado: 'indisponivel', motivo: 'limite de páginas por minuto' } });
    expect(e.tentarAposEm).toBe(T0 + 30_000);
    const c = vazioCache();
    gravar(c);
    expect(c).toEqual(vazioCache());
  });

  it('delta recusado num catálogo já lido: as ofertas lidas ficam; só os itens novos ficam indisponíveis', () => {
    const e = enriquecimentoVazio();
    e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk({ MLB1000000: { estado: 'nao_encontrada', preco: 10 } }) };
    const delta = { catalogos: [{ catalogProductId: 'MLB900', componentes: ['ofertas'] as ('produto' | 'ofertas')[], itens: [{ itemId: 'MLB1000001', preco: 10 }] }], perfis: [], perfisEmCache: [] };
    aplicarResposta(e, delta, comOfertas([], { catalogos: [{ catalogProductId: 'MLB900', estado: 'ok', retomarEm: null, consultadoEm: iso(T0), ofertas: { estado: 'indisponivel', motivo: 'tempo esgotado' } }] }), T0);
    expect(e.catalogos.MLB900.ofertas).toMatchObject({ estado: 'ok', exatas: { MLB1000000: { estado: 'nao_encontrada' }, MLB1000001: { estado: 'indisponivel', preco: 10, motivo: 'tempo esgotado' } } });
  });

  it('estado desconhecido (edge de outra versão) cai em indisponível, nunca em espera', () => {
    const e = enriquecimentoVazio();
    aplicarResposta(e, pedido, { consultadoEm: iso(T0), custo: { comandosRedis: 0, chamadasMl: 0 },
      catalogos: [{ catalogProductId: 'MLB900', estado: 'aguardando', retomarEm: null, consultadoEm: null }],
      vendedores: [{ sellerId: 9, estado: 'aguardando', retomarEm: null }] } as never, T0);
    expect(e.catalogos.MLB900.produto?.estado).toBe('indisponivel');
    expect(e.catalogos.MLB900.ofertas?.estado).toBe('indisponivel');
    expect(e.vendedores['9'].estado).toBe('indisponivel');
  });
});

describe('falha da rodada e "Tentar novamente"', () => {
  const pedido = { catalogos: [{ catalogProductId: 'MLB900', componentes: ['produto', 'ofertas'] as ('produto' | 'ofertas')[], itens: [{ itemId: 'MLB1000001', preco: 10 }] }], perfis: [9], perfisEmCache: [] };

  it('falha de rede: pedido marcado indisponível (terminal) e `falhou`; nova tentativa limpa tudo o que é indisponível', () => {
    const e = enriquecimentoVazio();
    marcarFalha(e, pedido, 'falha de rede');
    expect(e).toMatchObject({ falhou: true, catalogos: { MLB900: { produto: { estado: 'indisponivel', motivo: 'falha de rede' }, ofertas: { estado: 'indisponivel' } } }, vendedores: { 9: { estado: 'indisponivel' } } });
    expect(planejarLote([card(1)], {}, e, vazioCache(), T0, new Set()).pedido).toBeNull();
    e.catalogos.MLB2 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk({
      MLB1000002: { estado: 'ok', preco: 10, sellerId: 7, tipo: null, comissao: { estado: 'indisponivel', motivo: 'x' } },
      MLB1000003: { estado: 'indisponivel', preco: 10, motivo: 'tempo esgotado' },
      MLB1000004: { estado: 'nao_encontrada', preco: 10 } }) };
    expect(haParaTentar(e)).toBe(true);
    expect(prepararNovaTentativa(e, T0)).toBe(true);
    expect(haParaTentar(e)).toBe(false);
    expect(e.falhou).toBe(false);
    expect(e.catalogos.MLB900).toEqual({});
    expect(e.vendedores).toEqual({});
    expect(Object.keys((e.catalogos.MLB2.ofertas as { exatas: object }).exatas)).toEqual(['MLB1000004']);
    const p = planejarLote([card(1), card(2, { catalogProductId: 'MLB2' }), card(3, { catalogProductId: 'MLB2' }), card(4, { catalogProductId: 'MLB2' })], {}, e, vazioCache(), T0, new Set()).pedido!;
    expect(p.catalogos).toEqual([
      { catalogProductId: 'MLB900', componentes: ['produto', 'ofertas'], itens: [{ itemId: 'MLB1000001', preco: 10 }] },
      { catalogProductId: 'MLB2', componentes: ['ofertas'], itens: [{ itemId: 'MLB1000002', preco: 10 }, { itemId: 'MLB1000003', preco: 10 }] },
    ]);
  });

  it('antes do Retry-After do ML a nova tentativa é recusada (nada muda); depois, vale', () => {
    const e = enriquecimentoVazio();
    marcarFalha(e, pedido, 'limite do Mercado Livre');
    e.tentarAposEm = T0 + 10_000;
    expect(prepararNovaTentativa(e, T0)).toBe(false);
    expect(e.catalogos.MLB900.ofertas?.estado).toBe('indisponivel');
    expect(prepararNovaTentativa(e, T0 + 10_000)).toBe(true);
    expect(e.tentarAposEm).toBeNull();
  });

  it('nenhum caminho terminal deixa o card em "aguardando dados" (sem spinner eterno)', () => {
    const casos: ((e: EstadoEnriquecimento) => void)[] = [
      (e) => aplicarResposta(e, pedido, { consultadoEm: iso(T0), custo: { comandosRedis: 1, chamadasMl: 0 }, tentarAposEm: null, vendedores: [],
        catalogos: [{ catalogProductId: 'MLB900', estado: 'indisponivel', motivo: 'limite de páginas por minuto', retomarEm: null, consultadoEm: null }] } as never, T0),
      (e) => aplicarResposta(e, pedido, { consultadoEm: iso(T0), custo: { comandosRedis: 1, chamadasMl: 2 }, tentarAposEm: iso(T0 + 5000), vendedores: [],
        catalogos: [{ catalogProductId: 'MLB900', estado: 'ok', retomarEm: null, consultadoEm: iso(T0), produto: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' }, ofertas: { estado: 'indisponivel', motivo: 'tempo esgotado' } }] } as never, T0),
      (e) => marcarFalha(e, pedido, 'falha de rede'),
      (e) => {
        e.catalogos.MLB900 = { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertasOk({}) };
        marcarFalha(e, { ...pedido, catalogos: [{ ...pedido.catalogos[0], componentes: ['ofertas'] }] }, 'falha de rede');
      },
    ];
    for (const f of casos) {
      const e = enriquecimentoVazio();
      f(e);
      expect(vistaDoCard(card(1), e)!.espera).not.toBe('dados');
    }
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

  it('logout com a gravação em voo: o set que termina depois da limpeza não ressuscita o cache', async () => {
    logar();
    const set = vi.mocked(chrome.storage.session.set);
    let soltar!: () => void;
    const portao = new Promise<void>((r) => { soltar = r; });
    set.mockImplementationOnce(async (o: Record<string, unknown>) => { await portao; Object.assign(sessao, o); });
    const gravando = gravarCache('u1:org1:', (c) => { c.produtos.MLB1 = { criadoEm: null, exp: T0 + 10, u: T0 }; }, T0);
    await new Promise((r) => setTimeout(r, 0)); // o set já começou
    await sair();
    soltar();
    await gravando;
    expect(sessao['enr:cache']).toBeUndefined();
    logar();
    expect((await lerCache('u1:org1:', T0)).produtos).toEqual({});
  });

  it('limparEstadosDasAbas (saída, troca de identidade/suporte, sessão inválida) apaga o cache', async () => {
    await gravarCache('u1:org1:', (c) => { c.produtos.MLB1 = { criadoEm: null, exp: T0 + 10, u: T0 }; }, T0);
    expect(Object.keys(sessao).some((k) => k.startsWith('enr:'))).toBe(true);
    await limparEstadosDasAbas();
    expect(Object.keys(sessao).some((k) => k.startsWith('enr:'))).toBe(false);
  });
});
