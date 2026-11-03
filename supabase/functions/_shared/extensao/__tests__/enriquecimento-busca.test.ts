// Enriquecimento de catálogo da busca (Task 9, Revisão 03/11 regras 1–11): Redis falso em memória atrás do
// fetch do cliente REST real (conta comandos de verdade) + ML falso injetado (uma tentativa por chamada).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enriquecerCatalogosBusca, vendedorDoUsuario, type DepsEnriquecimento, type PedidoEnriquecimento, type RespostaMl } from '../enriquecimento-busca.ts';
import { chaveComissao } from '../../../extensao/roteamento.ts';

const db = new Map<string, string | number>();
let comandos: unknown[][] = [];
let redisFora = false;

const fetchRedis = vi.fn(async (_url: string, init: RequestInit) => {
  const cmd = JSON.parse(init.body as string) as [string, ...(string | number)[]];
  comandos.push(cmd);
  if (redisFora) return new Response('erro', { status: 500 });
  const [op, k, n] = cmd as [string, string, number];
  let result: unknown;
  if (op === 'INCRBY') { db.set(k, Number(db.get(k) ?? 0) + n); result = db.get(k); }
  else if (op === 'DECRBY') { db.set(k, Number(db.get(k) ?? 0) - n); result = db.get(k); }
  else if (op === 'EXPIRE') result = db.has(k) ? 1 : 0;
  else if (op === 'MGET') result = (cmd.slice(1) as string[]).map((c) => (typeof db.get(c) === 'string' ? db.get(c) : null));
  else if (op === 'SET') { db.set(k, cmd[2] as string); result = 'OK'; }
  else throw new Error(`comando inesperado ${op}`);
  return new Response(JSON.stringify({ result }), { status: 200 });
});

const AGORA = new Date('2026-11-03T14:05:30.000Z');
const PROXIMO = '2026-11-03T14:06:00.000Z';
const MAIS_6H = '2026-11-03T20:05:30.000Z'; // metadados do catálogo
const MAIS_60S = '2026-11-03T14:06:30.000Z'; // ofertas
const MAIS_24H = '2026-11-04T14:05:30.000Z'; // perfis
const ML = 'https://api.mercadolibre.com';
const CONTA = '555';
const LP_OK = { sale_fee_amount: 12, sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } };

let respostasMl: Map<string, RespostaMl>;
let urlsMl: string[];
let relogio: Date[];

function deps(): DepsEnriquecimento {
  return {
    conta: CONTA,
    agora: () => relogio.length > 1 ? relogio.shift()! : relogio[0],
    getMl: async (url) => { urlsMl.push(url); return respostasMl.get(url) ?? { status: 0, corpo: null }; },
  };
}

const ok = (corpo: unknown): RespostaMl => ({ status: 200, corpo });
const oferta = (item: string, seller: number, extra: Record<string, unknown> = {}) =>
  ({ item_id: item, seller_id: seller, category_id: 'MLB5', listing_type_id: 'gold_special', price: 99, ...extra });
const ofertas = (results: unknown[], total = results.length) => ok({ paging: { total, offset: 0, limit: 100 }, results });
const usuario = (id: number, rep: Record<string, unknown> = { power_seller_status: 'gold', transactions: { period: 'historic', total: 10 } }) =>
  ok({ id, nickname: `V${id}`, address: { state: 'BR-SP' }, seller_reputation: rep });
const urlLp = (preco: number, cat = 'MLB5', tipo = 'gold_special') => `${ML}/sites/MLB/listing_prices?price=${preco}&category_id=${cat}&listing_type_id=${tipo}`;
const pedido = (catalogos: PedidoEnriquecimento['catalogos'], extra: Partial<PedidoEnriquecimento> = {}): PedidoEnriquecimento =>
  ({ catalogos, perfis: [], perfisEmCache: [], ...extra });
const cat = (id: string, itens: { itemId: string; preco: number }[] = [], componentes: ('produto' | 'ofertas')[] = ['produto', 'ofertas']) =>
  ({ catalogProductId: id, componentes, itens });
const ops = () => comandos.map((c) => c[0]);
const run = (p: PedidoEnriquecimento) => enriquecerCatalogosBusca('org1', 'u1', p, deps());

beforeEach(() => {
  db.clear(); comandos = []; redisFora = false; respostasMl = new Map(); urlsMl = []; relogio = [AGORA];
  vi.stubGlobal('fetch', fetchRedis);
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'UPSTASH_REDIS_REST_URL' ? 'https://r.test' : 'tok') } });
});

describe('vendedorDoUsuario (perfil de terceiro, sem exigir transactions.total)', () => {
  it('medalha explícita, UF e nome', () => {
    expect(vendedorDoUsuario({ nickname: 'X', address: { state: 'BR-RJ' }, seller_reputation: { power_seller_status: 'platinum' } }))
      .toEqual({ nome: 'X', medalha: 'platinum', uf: 'RJ' });
  });
  it('vendedor sem transações ainda traz medalha e UF', () => {
    expect(vendedorDoUsuario({ nickname: 'X', address: { state: 'SP' }, seller_reputation: { power_seller_status: 'silver' } }))
      .toEqual({ nome: 'X', medalha: 'silver', uf: 'SP' });
  });
  it('power_seller_status null explícito → "sem"', () => {
    expect(vendedorDoUsuario({ seller_reputation: { power_seller_status: null } }).medalha).toBe('sem');
  });
  it.each([
    ['ausente', { seller_reputation: {} }],
    ['desconhecido', { seller_reputation: { power_seller_status: 'diamond' } }],
    ['sem reputação', {}],
    ['corpo inválido', null],
  ])('status %s → null (desconhecido, nunca "sem")', (_n, corpo) => {
    expect(vendedorDoUsuario(corpo)).toEqual({ nome: null, medalha: null, uf: null });
  });
});

describe('enriquecerCatalogosBusca — componentes e ofertas exatas', () => {
  it('catálogo completo: data, vendedores únicos, oferta exata com categoria/tipo/vendedor/comissão', async () => {
    respostasMl.set(`${ML}/products/MLB1`, ok({ id: 'MLB1', date_created: '2024-01-02T00:00:00Z', buy_box_winner: { item_id: 'MLB9' } }));
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7), oferta('MLB11', 7), oferta('MLB12', 8, { category_id: 'MLB6', listing_type_id: 'gold_pro' })]));
    respostasMl.set(`${ML}/users/8`, usuario(8));
    respostasMl.set(urlLp(150, 'MLB6', 'gold_pro'), ok(LP_OK));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB12', preco: 150 }])]));
    expect(r.catalogos).toEqual([{
      catalogProductId: 'MLB1', estado: 'ok', retomarEm: null, consultadoEm: AGORA.toISOString(),
      produto: { estado: 'ok', criadoEm: '2024-01-02T00:00:00Z', expiraEm: MAIS_6H },
      ofertas: {
        estado: 'ok', expiraEm: MAIS_60S, total: 3, lidas: 3, vendedoresIdentificados: 2, ofertasSemVendedor: 0, completa: true,
        exatas: [{
          itemId: 'MLB12', estado: 'ok', categoriaId: 'MLB6', sellerId: 8, tipo: 'gold_pro', perfil: 'carregado',
          comissaoNaSuaConta: { estado: 'ok', valor: { percentual: 12, fixa: 0, saleFeeAmount: 12, precoConsultado: 150 } },
        }],
      },
    }]);
    expect(r.vendedores).toEqual([{ sellerId: 8, estado: 'ok', nome: 'V8', medalha: 'gold', uf: 'SP', expiraEm: MAIS_24H }]);
    // "ganhador" nunca vem de /products (regra 6)
    expect(JSON.stringify(r)).not.toMatch(/winner|ganhador|MLB9/);
    // só o perfil do vendedor da oferta exata
    expect(urlsMl.filter((u) => u.includes('/users/'))).toEqual([`${ML}/users/8`]);
    expect(r.custo.chamadasMl).toBe(4);
  });

  it('pedido parcial: só ofertas (metadados em cache no navegador) não consulta /products', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7)]));
    const r = await run(pedido([cat('MLB1', [], ['ofertas'])], { perfisEmCache: [7] }));
    expect(urlsMl).toEqual([`${ML}/products/MLB1/items?limit=100`]);
    expect(r.catalogos[0]).not.toHaveProperty('produto');
    expect(r.catalogos[0].ofertas).toMatchObject({ estado: 'ok', vendedoresIdentificados: 1 });
  });

  it('pedido parcial: só produto não lê ofertas nem perfis', async () => {
    respostasMl.set(`${ML}/products/MLB1`, ok({ date_created: '2024-01-02T00:00:00Z' }));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['produto'])]));
    expect(urlsMl).toEqual([`${ML}/products/MLB1`]);
    expect(r.catalogos[0]).not.toHaveProperty('ofertas');
    expect(r.vendedores).toEqual([]);
  });

  it('404 "No winners found" = 0 ofertas / 0 vendedores, não falha', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, { status: 404, corpo: { message: 'No winners found', error: 'not_found', status: 404 } });
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])]));
    expect(r.catalogos[0].ofertas).toEqual({
      estado: 'ok', expiraEm: MAIS_60S, total: 0, lidas: 0, vendedoresIdentificados: 0, ofertasSemVendedor: 0, completa: true,
      exatas: [{ itemId: 'MLB10', estado: 'nao_encontrada', motivo: 'catálogo sem ofertas' }],
    });
  });

  it('outro 404 é indisponível', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, { status: 404, corpo: { message: 'Product not found' } });
    respostasMl.set(`${ML}/products/MLB1`, { status: 404, corpo: { message: 'not found' } });
    const r = await run(pedido([cat('MLB1')]));
    expect(r.catalogos[0].ofertas).toEqual({ estado: 'indisponivel', motivo: 'ofertas indisponíveis' });
    expect(r.catalogos[0].produto).toEqual({ estado: 'indisponivel', motivo: 'catálogo indisponível' });
  });

  it('oferta exata ausente: sem vendedor/categoria/tipo/comissão, metadados do catálogo mantidos', async () => {
    respostasMl.set(`${ML}/products/MLB1`, ok({ date_created: '2024-01-02T00:00:00Z' }));
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7)]));
    respostasMl.set(`${ML}/users/7`, usuario(7));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB99', preco: 10 }])]));
    expect(r.catalogos[0].produto).toEqual({ estado: 'ok', criadoEm: '2024-01-02T00:00:00Z', expiraEm: MAIS_6H });
    expect(r.catalogos[0].ofertas).toMatchObject({ estado: 'ok', total: 1, vendedoresIdentificados: 1,
      exatas: [{ itemId: 'MLB99', estado: 'nao_encontrada', motivo: 'oferta não está entre as ofertas do catálogo' }] });
    expect(urlsMl.some((u) => u.includes('/users/') || u.includes('listing_prices'))).toBe(false);
    expect(r.vendedores).toEqual([]);
  });

  it('ficha > 100 ofertas: leitura parcial (≥ N), oferta ausente com motivo próprio', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7), oferta('MLB11', 8)], 117));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB99', preco: 10 }], ['ofertas'])]));
    expect(r.catalogos[0].ofertas).toMatchObject({ estado: 'ok', total: 117, lidas: 2, vendedoresIdentificados: 2, completa: false,
      exatas: [{ itemId: 'MLB99', estado: 'nao_encontrada', motivo: 'oferta fora das ofertas lidas' }] });
  });

  it('paging ausente: total null e leitura não comprovada completa', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ok({ results: [oferta('MLB10', 7)] }));
    const r = await run(pedido([cat('MLB1', [], ['ofertas'])], { perfisEmCache: [7] }));
    expect(r.catalogos[0].ofertas).toMatchObject({ total: null, lidas: 1, completa: false });
  });

  it('mesmo vendedor em dois itens exatos: contado uma vez e um único /users', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7), oferta('MLB11', 7)]));
    respostasMl.set(`${ML}/products/MLB2/items?limit=100`, ofertas([oferta('MLB20', 7)]));
    respostasMl.set(`${ML}/users/7`, usuario(7));
    respostasMl.set(urlLp(10), ok(LP_OK));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }, { itemId: 'MLB11', preco: 10 }], ['ofertas']), cat('MLB2', [{ itemId: 'MLB20', preco: 10 }], ['ofertas'])]));
    expect(r.catalogos[0].ofertas).toMatchObject({ vendedoresIdentificados: 1 });
    expect(urlsMl.filter((u) => u === `${ML}/users/7`)).toHaveLength(1);
    expect(r.vendedores).toHaveLength(1);
    // comissão: chave deduplicada (mesma conta/categoria/tipo/preço) → um listing_prices
    expect(urlsMl.filter((u) => u.includes('listing_prices'))).toHaveLength(1);
  });

  it('tipo fora de gold_special/gold_pro → tipo null e comissão indisponível, sem listing_prices', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7, { listing_type_id: 'free' })]));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])], { perfisEmCache: [7] }));
    expect(r.catalogos[0].ofertas).toMatchObject({ exatas: [{ tipo: null, comissaoNaSuaConta: { estado: 'indisponivel', motivo: 'tipo do anúncio não confirmado' } }] });
    expect(urlsMl.some((u) => u.includes('listing_prices'))).toBe(false);
  });

  it('perfis: explícitos + derivados, sem os em cache no navegador, no máximo 5', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([1, 2, 3, 4, 5].map((s) => oferta(`MLB1${s}`, s, { listing_type_id: 'x' }))));
    for (const s of [1, 2, 3, 4, 5, 40, 41]) respostasMl.set(`${ML}/users/${s}`, usuario(s));
    const r = await run(pedido([cat('MLB1', [1, 2, 3, 4, 5].map((s) => ({ itemId: `MLB1${s}`, preco: 10 })), ['ofertas'])], { perfis: [40, 41], perfisEmCache: [2] }));
    expect(urlsMl.filter((u) => u.includes('/users/'))).toEqual([40, 41, 1, 3, 4].map((s) => `${ML}/users/${s}`));
    expect(r.vendedores.map((v) => [v.sellerId, v.estado])).toEqual([[40, 'ok'], [41, 'ok'], [1, 'ok'], [3, 'ok'], [4, 'ok'], [5, 'aguardando']]);
    expect(r.vendedores.at(-1)).toEqual({ sellerId: 5, estado: 'aguardando', retomarEm: null, motivo: 'limite de perfis por pedido' });
  });

  it('saldo de perfis da busca (perfisRestantes) limita também os automáticos; 0 = nenhum /users', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([1, 2, 3].map((s) => oferta(`MLB1${s}`, s, { listing_type_id: 'x' }))));
    for (const s of [1, 2, 3]) respostasMl.set(`${ML}/users/${s}`, usuario(s));
    const itens = [1, 2, 3].map((s) => ({ itemId: `MLB1${s}`, preco: 10 }));
    const zero = await run(pedido([cat('MLB1', itens, ['ofertas'])], { perfisRestantes: 0 }));
    expect(urlsMl.filter((u) => u.includes('/users/'))).toEqual([]);
    expect(zero.vendedores).toEqual([1, 2, 3].map((sellerId) => ({ sellerId, estado: 'indisponivel', motivo: 'limite de perfis da busca' })));
    expect((zero.catalogos[0].ofertas as { exatas: { perfil: unknown }[] }).exatas.map((e) => e.perfil)).toEqual(['indisponivel', 'indisponivel', 'indisponivel']);
    urlsMl = [];
    const dois = await run(pedido([cat('MLB1', itens, ['ofertas'])], { perfisRestantes: 2 }));
    expect(urlsMl.filter((u) => u.includes('/users/'))).toEqual([1, 2].map((s) => `${ML}/users/${s}`));
    expect(dois.vendedores.map((v) => [v.sellerId, v.estado])).toEqual([[1, 'ok'], [2, 'ok'], [3, 'indisponivel']]);
  });

  it('oferta sem seller_id: identificação incompleta explícita, nunca "0 vendedores, completa"', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7, { seller_id: undefined })]));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])]));
    expect(r.catalogos[0].ofertas).toMatchObject({ estado: 'ok', total: 1, lidas: 1, vendedoresIdentificados: 0, ofertasSemVendedor: 1, completa: false,
      exatas: [{ itemId: 'MLB10', sellerId: null, perfil: null }] });
  });

  it('mesmo catálogo com 7 itens: todos casados; perfis além de 5 voltam pendentes no item e em vendedores[]', async () => {
    const s = [1, 2, 3, 4, 5, 6, 7];
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas(s.map((x) => oferta(`MLB1${x}`, x, { listing_type_id: 'x' }))));
    for (const x of s) respostasMl.set(`${ML}/users/${x}`, usuario(x));
    respostasMl.set(`${ML}/users/3`, { status: 403, corpo: null });
    const r = await run(pedido([cat('MLB1', s.map((x) => ({ itemId: `MLB1${x}`, preco: 10 })), ['ofertas'])], { perfisEmCache: [2] }));
    const ex = (r.catalogos[0].ofertas as { exatas: { itemId: string; perfil: unknown }[] }).exatas;
    expect(ex.map((e) => e.perfil)).toEqual(['carregado', 'no_navegador', 'indisponivel', 'carregado', 'carregado', 'carregado', 'aguardando']);
    expect(r.vendedores.find((v) => v.sellerId === 7)).toEqual({ sellerId: 7, estado: 'aguardando', retomarEm: null, motivo: 'limite de perfis por pedido' });
  });

  it('expiraEm só em componente ok; aguardando/indisponível não têm expiração', async () => {
    respostasMl.set(`${ML}/products/MLB1`, { status: 429, corpo: null });
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, { status: 403, corpo: null });
    const r = await run(pedido([cat('MLB1')]));
    expect(r.catalogos[0]).toEqual({ catalogProductId: 'MLB1', estado: 'ok', retomarEm: null, consultadoEm: AGORA.toISOString(),
      produto: { estado: 'aguardando', retomarEm: null }, ofertas: { estado: 'indisponivel', motivo: 'ofertas indisponíveis' } });
  });

  it('pedido só de perfis (ofertas em cache no navegador): debita 1 da cota', async () => {
    respostasMl.set(`${ML}/users/40`, usuario(40, { power_seller_status: null }));
    const r = await run(pedido([], { perfis: [40] }));
    expect(r.vendedores).toEqual([{ sellerId: 40, estado: 'ok', nome: 'V40', medalha: 'sem', uf: 'SP', expiraEm: MAIS_24H }]);
    expect(db.get('ext:enr:org1:u1:202611031405')).toBe(1);
  });
});

describe('falhas por endpoint (uma tentativa, chamada despachada conta)', () => {
  it.each([[403], [429], [0]])('status %s em /products, /items, /users e listing_prices', async (status) => {
    respostasMl.set(`${ML}/products/MLB1`, { status, corpo: null });
    respostasMl.set(`${ML}/products/MLB2/items?limit=100`, { status, corpo: null });
    respostasMl.set(`${ML}/products/MLB3/items?limit=100`, ofertas([oferta('MLB30', 7)]));
    respostasMl.set(`${ML}/users/7`, { status, corpo: null });
    respostasMl.set(urlLp(10), { status, corpo: null });
    const r = await run(pedido([cat('MLB1', [], ['produto']), cat('MLB2', [], ['ofertas']), cat('MLB3', [{ itemId: 'MLB30', preco: 10 }], ['ofertas'])]));
    const espera = status === 429;
    expect(r.catalogos[0].produto).toEqual(espera ? { estado: 'aguardando', retomarEm: null } : { estado: 'indisponivel', motivo: 'catálogo indisponível' });
    expect(r.catalogos[1].ofertas).toEqual(espera ? { estado: 'aguardando', retomarEm: null } : { estado: 'indisponivel', motivo: 'ofertas indisponíveis' });
    expect(r.vendedores[0]).toEqual(espera ? { sellerId: 7, estado: 'aguardando', retomarEm: null } : { sellerId: 7, estado: 'indisponivel', motivo: 'perfil indisponível' });
    expect(r.catalogos[2].ofertas).toMatchObject({ exatas: [{ comissaoNaSuaConta: espera ? { estado: 'aguardando', retomarEm: null } : { estado: 'indisponivel', motivo: 'comissão indisponível' } }] });
    // uma tentativa por chamada; todas contam no orçamento (nenhuma devolução)
    expect(urlsMl).toHaveLength(5);
    expect(r.custo.chamadasMl).toBe(5);
    expect(ops()).not.toContain('DECRBY');
    expect(ops()).not.toContain('SET');
  });
});

describe('cota de enriquecimento e orçamento global', () => {
  it('cota parcial: catálogos além do concedido ficam "aguardando" com retomarEm e não vão ao ML', async () => {
    db.set('ext:enr:org1:u1:202611031405', 8);
    for (const id of ['MLB1', 'MLB2', 'MLB3']) respostasMl.set(`${ML}/products/${id}`, ok({ date_created: '2024-01-02T00:00:00Z' }));
    const r = await run(pedido(['MLB1', 'MLB2', 'MLB3'].map((id) => cat(id, [], ['produto']))));
    expect(r.catalogos.map((c) => c.estado)).toEqual(['ok', 'ok', 'aguardando']);
    expect(r.catalogos[2]).toEqual({ catalogProductId: 'MLB3', estado: 'aguardando', retomarEm: PROXIMO, consultadoEm: null });
    expect(urlsMl).toEqual([`${ML}/products/MLB1`, `${ML}/products/MLB2`]);
  });

  it('orçamento global esgotado: fail-closed, zero chamadas ML, "aguardando"', async () => {
    db.set('ext:mlapp:202611031405', 120);
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }])]));
    expect(urlsMl).toEqual([]);
    expect(r.catalogos[0]).toMatchObject({ estado: 'ok', produto: { estado: 'aguardando', retomarEm: PROXIMO }, ofertas: { estado: 'aguardando', retomarEm: PROXIMO } });
    expect(r.custo.chamadasMl).toBe(0);
  });

  it('Redis fora: cota fail-closed, nada vai ao ML', async () => {
    redisFora = true;
    const r = await run(pedido([cat('MLB1')]));
    expect(urlsMl).toEqual([]);
    expect(r.catalogos[0]).toEqual({ catalogProductId: 'MLB1', estado: 'aguardando', retomarEm: PROXIMO, consultadoEm: null });
  });

  it('orçamento parcial: despacha só o concedido e o restante fica aguardando', async () => {
    db.set('ext:mlapp:202611031405', 117);
    for (const id of ['MLB1', 'MLB2']) respostasMl.set(`${ML}/products/${id}`, ok({ date_created: '2024-01-02T00:00:00Z' }));
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([]));
    const r = await run(pedido([cat('MLB1'), cat('MLB2')]));
    expect(urlsMl).toHaveLength(3);
    expect(r.catalogos[1].ofertas).toEqual({ estado: 'aguardando', retomarEm: PROXIMO });
    expect(db.get('ext:mlapp:202611031405')).toBe(120);
  });

  it('fase 2: comissão sem orçamento fica aguardando e o resto do catálogo é entregue', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7)]));
    // a fase 1 leva a janela a 120: a fase 2 não tem saldo
    db.set('ext:mlapp:202611031405', 119);
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])], { perfisEmCache: [7] }));
    expect(r.catalogos[0].ofertas).toMatchObject({ estado: 'ok', exatas: [{ estado: 'ok', sellerId: 7, comissaoNaSuaConta: { estado: 'aguardando', retomarEm: PROXIMO } }] });
    expect(urlsMl).toHaveLength(1);
  });

  it('virada do minuto no meio da fase: devolve o não despachado na chave antiga e reserva de novo na nova', async () => {
    const ids = ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5'];
    for (const id of ids) { respostasMl.set(`${ML}/products/${id}`, ok({ date_created: '2024-01-02T00:00:00Z' })); respostasMl.set(`${ML}/products/${id}/items?limit=100`, ofertas([])); }
    const DEPOIS = new Date('2026-11-03T14:06:01.000Z');
    // agora(): cota, reserva fase 1, 1ª onda (mesmo minuto), 2ª onda (virou) …
    relogio = [AGORA, AGORA, AGORA, DEPOIS];
    const r = await run(pedido(ids.map((id) => cat(id))));
    expect(urlsMl).toHaveLength(10);
    expect(r.catalogos.every((c) => c.ofertas?.estado === 'ok' && c.produto?.estado === 'ok')).toBe(true);
    // 10 reservadas em 14:05, 5 despachadas lá; 5 devolvidas e reservadas em 14:06
    expect(db.get('ext:mlapp:202611031405')).toBe(5);
    expect(db.get('ext:mlapp:202611031406')).toBe(5);
  });

  it('devolve só as não despachadas (perfis já em cache: fase 2 vazia não reserva)', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7)]));
    respostasMl.set(urlLp(10), ok(LP_OK));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])], { perfisEmCache: [7] }));
    expect(r.custo.chamadasMl).toBe(2);
    expect(db.get('ext:mlapp:202611031405')).toBe(2);
    expect(ops()).not.toContain('DECRBY');
  });
});

describe('comissão: chave existente, um MGET por lote, grava só os misses', () => {
  it('um MGET com chaves deduplicadas; hit não chama listing_prices; miss ok é gravado; indisponível não', async () => {
    const hit = { estado: 'ok', valor: { percentual: 11, fixa: 0 } };
    db.set(chaveComissao(CONTA, 'MLB5', 'gold_special', 10), JSON.stringify(hit));
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7), oferta('MLB11', 7), oferta('MLB12', 7, { listing_type_id: 'gold_pro' })]));
    respostasMl.set(urlLp(20), ok(LP_OK));
    respostasMl.set(urlLp(10, 'MLB5', 'gold_pro'), ok({ sale_fee_amount: 5 })); // sem sale_fee_details → indisponível
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }, { itemId: 'MLB11', preco: 20 }, { itemId: 'MLB12', preco: 10 }], ['ofertas'])], { perfisEmCache: [7] }));
    const mgets = comandos.filter((c) => c[0] === 'MGET');
    expect(mgets).toHaveLength(1);
    expect(mgets[0].slice(1)).toEqual([chaveComissao(CONTA, 'MLB5', 'gold_special', 10), chaveComissao(CONTA, 'MLB5', 'gold_special', 20), chaveComissao(CONTA, 'MLB5', 'gold_pro', 10)]);
    expect(urlsMl.filter((u) => u.includes('listing_prices'))).toEqual([urlLp(20), urlLp(10, 'MLB5', 'gold_pro')]);
    const ex = (r.catalogos[0].ofertas as { exatas: { comissaoNaSuaConta: unknown }[] }).exatas.map((e) => e.comissaoNaSuaConta);
    expect(ex[0]).toEqual(hit);
    expect(ex[1]).toMatchObject({ estado: 'ok', valor: { saleFeeAmount: 12, precoConsultado: 20 } });
    expect(ex[2]).toMatchObject({ estado: 'indisponivel' });
    const sets = comandos.filter((c) => c[0] === 'SET');
    expect(sets.map((c) => [c[1], c[3], c[4]])).toEqual([[chaveComissao(CONTA, 'MLB5', 'gold_special', 20), 'EX', 6 * 3600]]);
  });

  it('valor inválido no cache = miss', async () => {
    db.set(chaveComissao(CONTA, 'MLB5', 'gold_special', 10), '{lixo');
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7)]));
    respostasMl.set(urlLp(10), ok(LP_OK));
    await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])], { perfisEmCache: [7] }));
    expect(urlsMl.filter((u) => u.includes('listing_prices'))).toHaveLength(1);
  });

  it('lote de 5 com comissão quente e perfis no navegador: ≤ 6 comandos Redis, contados no custo, sem GET/SET de produto/oferta/perfil', async () => {
    const ids = ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5'];
    for (const [i, id] of ids.entries()) {
      respostasMl.set(`${ML}/products/${id}`, ok({ date_created: '2024-01-02T00:00:00Z' }));
      respostasMl.set(`${ML}/products/${id}/items?limit=100`, ofertas([oferta(`${id}0`, 7 + i)]));
      db.set(chaveComissao(CONTA, 'MLB5', 'gold_special', 10 + i), JSON.stringify({ estado: 'ok', valor: { percentual: 12, fixa: 0 } }));
    }
    const r = await run(pedido(ids.map((id, i) => cat(id, [{ itemId: `${id}0`, preco: 10 + i }])), { perfisEmCache: [7, 8, 9, 10, 11] }));
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY', 'EXPIRE', 'MGET']);
    expect(comandos.length).toBeLessThanOrEqual(6);
    expect(r.custo).toEqual({ comandosRedis: comandos.length, chamadasMl: 10 });
    expect(comandos.some((c) => c[0] === 'GET' || c[0] === 'SET')).toBe(false);
  });

  it('custo.comandosRedis = comandos vistos pelo Redis no caminho frio (perfil + comissão gravada)', async () => {
    db.set('ext:mlapp:202611031405', 1);
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7)]));
    respostasMl.set(`${ML}/users/7`, usuario(7));
    respostasMl.set(urlLp(10), ok(LP_OK));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])]));
    expect(r.custo.comandosRedis).toBe(comandos.length);
    expect(ops()).toContain('SET');
  });
});
