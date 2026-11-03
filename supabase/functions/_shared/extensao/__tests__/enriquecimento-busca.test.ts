// Enriquecimento de catálogo da busca (Revisão 03/11-b, lote por página): Redis falso em memória atrás do
// fetch do cliente REST real (conta comandos de verdade) + ML falso injetado (uma tentativa por chamada, assíncrono
// para medir simultaneidade) + relógio controlado (deadline e virada do minuto).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enriquecerCatalogosBusca, vendedorDoUsuario, type DepsEnriquecimento, type PedidoEnriquecimento, type RespostaMl } from '../enriquecimento-busca.ts';
import { chaveComissao } from '../../../extensao/roteamento.ts';

const db = new Map<string, string | number>();
let comandos: unknown[][] = [];
let redisFora = false;
let falharPrefixo: string | null = null;

const fetchRedis = vi.fn(async (_url: string, init: RequestInit) => {
  const cmd = JSON.parse(init.body as string) as [string, ...(string | number)[]];
  comandos.push(cmd);
  if (redisFora || (falharPrefixo && String(cmd[1]).startsWith(falharPrefixo))) return new Response('erro', { status: 500 });
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
const MAIS_6H = '2026-11-03T20:05:30.000Z'; // metadados do catálogo
const MAIS_60S = '2026-11-03T14:06:30.000Z'; // ofertas
const MAIS_24H = '2026-11-04T14:05:30.000Z'; // perfis
const ML = 'https://api.mercadolibre.com';
const CONTA = '555';
const LP_OK = { sale_fee_amount: 12, sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } };

let respostasMl: Map<string, RespostaMl>;
let urlsMl: string[];
let timeouts: number[];
let agoraMs: number;
let ativos: number; let maxAtivos: number; let ativosLp: number; let maxLp: number;
/** Chamado a cada GET despachado (avança o relógio, aborta, …). */
let aoChamar: (url: string) => void;
let extra: Partial<DepsEnriquecimento>;

function deps(): DepsEnriquecimento {
  return {
    conta: CONTA,
    agora: () => new Date(agoraMs),
    getMl: async (url, timeoutMs) => {
      urlsMl.push(url); timeouts.push(timeoutMs); aoChamar(url);
      const lp = url.includes('listing_prices');
      ativos++; maxAtivos = Math.max(maxAtivos, ativos);
      if (lp) { ativosLp++; maxLp = Math.max(maxLp, ativosLp); }
      await new Promise((r) => setTimeout(r, 1));
      ativos--; if (lp) ativosLp--;
      return respostasMl.get(url) ?? { status: 0, corpo: null };
    },
    ...extra,
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
const run = (p: PedidoEnriquecimento, org = 'org1', user = 'u1') => enriquecerCatalogosBusca(org, user, p, deps());
const IND_ML = { estado: 'indisponivel', motivo: 'limite do Mercado Livre' };
const IND_ORC = { estado: 'indisponivel', motivo: 'orçamento do app esgotado' };
const IND_TEMPO = { estado: 'indisponivel', motivo: 'tempo esgotado' };
const CHAVE_PAG = 'ext:enr:pagina:v1:org1:u1:202611031405';
const CHAVE_ML = 'ext:mlapp:202611031405';
const exatasDe = (c: unknown) => (c as { ofertas: { exatas: Record<string, unknown>[] } }).ofertas.exatas;

beforeEach(() => {
  db.clear(); comandos = []; redisFora = false; falharPrefixo = null; respostasMl = new Map(); urlsMl = []; timeouts = []; agoraMs = AGORA.getTime();
  ativos = 0; maxAtivos = 0; ativosLp = 0; maxLp = 0; aoChamar = () => {}; extra = {};
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

  it('oferta sem seller_id: identificação incompleta explícita, nunca "0 vendedores, completa"', async () => {
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7, { seller_id: undefined })]));
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])]));
    expect(r.catalogos[0].ofertas).toMatchObject({ estado: 'ok', total: 1, lidas: 1, vendedoresIdentificados: 0, ofertasSemVendedor: 1, completa: false,
      exatas: [{ itemId: 'MLB10', sellerId: null, perfil: null }] });
  });


  it('mesmo catálogo com 7 itens: todos casados; perfil em cache, carregado ou indisponível (nunca pendente)', async () => {
    const s = [1, 2, 3, 4, 5, 6, 7];
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas(s.map((x) => oferta(`MLB1${x}`, x, { listing_type_id: 'x' }))));
    for (const x of s) respostasMl.set(`${ML}/users/${x}`, usuario(x));
    respostasMl.set(`${ML}/users/3`, { status: 403, corpo: null });
    const r = await run(pedido([cat('MLB1', s.map((x) => ({ itemId: `MLB1${x}`, preco: 10 })), ['ofertas'])], { perfisEmCache: [2] }));
    expect(exatasDe(r.catalogos[0]).map((e) => e.perfil)).toEqual(['carregado', 'no_navegador', 'indisponivel', 'carregado', 'carregado', 'carregado', 'carregado']);
    expect(r.vendedores.find((v) => v.sellerId === 3)).toEqual({ sellerId: 3, estado: 'indisponivel', motivo: 'perfil indisponível' });
  });

  it('expiraEm só em componente ok; indisponível não tem expiração', async () => {
    respostasMl.set(`${ML}/products/MLB1`, { status: 429, corpo: null });
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, { status: 403, corpo: null });
    const r = await run(pedido([cat('MLB1')]));
    expect(r.catalogos[0]).toEqual({ catalogProductId: 'MLB1', estado: 'ok', retomarEm: null, consultadoEm: AGORA.toISOString(),
      produto: IND_ML, ofertas: { estado: 'indisponivel', motivo: 'ofertas indisponíveis' } });
  });

  it('pedido só de perfis (ofertas em cache no navegador): debita 1 página', async () => {
    respostasMl.set(`${ML}/users/40`, usuario(40, { power_seller_status: null }));
    const r = await run(pedido([], { perfis: [40] }));
    expect(r.vendedores).toEqual([{ sellerId: 40, estado: 'ok', nome: 'V40', medalha: 'sem', uf: 'SP', expiraEm: MAIS_24H }]);
    expect(db.get(CHAVE_PAG)).toBe(1);
  });
});

/** Página fria: n catálogos, um item cada; vendedor `100 + i % vendedores`; preços distintos (comissões distintas). */
function pagina(n: number, vendedores = n) {
  const ids = Array.from({ length: n }, (_, i) => `MLB${1000 + i}`);
  ids.forEach((id, i) => {
    respostasMl.set(`${ML}/products/${id}`, ok({ date_created: '2024-01-02T00:00:00Z' }));
    respostasMl.set(`${ML}/products/${id}/items?limit=100`, ofertas([oferta(`${id}0`, 100 + (i % vendedores))]));
    respostasMl.set(`${ML}/users/${100 + (i % vendedores)}`, usuario(100 + (i % vendedores)));
    respostasMl.set(urlLp(10 + i), ok(LP_OK));
  });
  return pedido(ids.map((id, i) => cat(id, [{ itemId: `${id}0`, preco: 10 + i }])));
}
const contar = (trecho: string) => urlsMl.filter((u) => u.includes(trecho)).length;

describe('página inteira numa requisição (pool contínuo, reserva única)', () => {
  it('50 catálogos frios: tudo carregado, reserva 200 usada inteira, 4 comandos Redis = custo, nenhum SET', async () => {
    const r = await run(pagina(50));
    expect(r.catalogos).toHaveLength(50);
    expect(r.catalogos.every((c) => c.produto?.estado === 'ok' && c.ofertas?.estado === 'ok')).toBe(true);
    expect(r.catalogos.flatMap((c) => exatasDe(c)).every((e) => e.perfil === 'carregado' && (e.comissaoNaSuaConta as { estado: string }).estado === 'ok')).toBe(true);
    expect(r.vendedores).toHaveLength(50);
    expect(r.custo.chamadasMl).toBe(200);
    expect(urlsMl).toHaveLength(200);
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY', 'EXPIRE', 'MGET']);
    expect(comandos[2]).toEqual(['INCRBY', CHAVE_ML, 200]);
    expect(r.custo.comandosRedis).toBe(comandos.length);
  });

  it('página típica (50 catálogos, 40 vendedores): 40 /users, reserva 200, usa 190, devolve 10 uma vez → 6 comandos', async () => {
    const r = await run(pagina(50, 40));
    expect(contar('/users/')).toBe(40);
    expect(new Set(urlsMl.filter((u) => u.includes('/users/'))).size).toBe(40);
    expect(r.custo.chamadasMl).toBe(190);
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY', 'EXPIRE', 'MGET', 'DECRBY']);
    expect(comandos.at(-1)).toEqual(['DECRBY', CHAVE_ML, 10]);
    expect(db.get(CHAVE_ML)).toBe(190);
    expect(r.custo.comandosRedis).toBe(comandos.length);
  });

  it('simultaneidade: pool de 16, listing_prices no máximo 4 ao mesmo tempo', async () => {
    await run(pagina(40));
    expect(maxAtivos).toBe(16);
    expect(maxLp).toBe(4);
    expect(contar('listing_prices')).toBe(40);
  });

  it('vendedor repetido na página inteira: um /users só; perfis em cache no navegador não são consultados', async () => {
    await run(pagina(10, 1));
    expect(urlsMl.filter((u) => u.includes('/users/'))).toEqual([`${ML}/users/100`]);
    urlsMl = [];
    await run({ ...pagina(10, 2), perfisEmCache: [100] });
    expect(urlsMl.filter((u) => u.includes('/users/'))).toEqual([`${ML}/users/101`]);
  });

  it('perfis: explícitos + derivados deduplicados, sem os em cache, até 50; o excedente fica indisponível', async () => {
    const explicitos = Array.from({ length: 50 }, (_, i) => 500 + i);
    for (const s of explicitos) respostasMl.set(`${ML}/users/${s}`, usuario(s));
    const r = await run({ ...pagina(1), perfis: [...explicitos, 100] });
    expect(contar('/users/')).toBe(50);
    expect(r.vendedores).toHaveLength(51);
    expect(r.vendedores.at(-1)).toEqual({ sellerId: 100, estado: 'indisponivel', motivo: 'limite de perfis por pedido' });
    expect(exatasDe(r.catalogos[0])[0].perfil).toBe('indisponivel');
  });

  it('chamadas nunca excedem a reserva: concessão parcial despacha só o concedido; fase 1 primeiro, perfis antes de comissão', async () => {
    db.set(CHAVE_ML, 950);
    const r = await run(pagina(50));
    expect(urlsMl).toHaveLength(50);
    expect(r.custo.chamadasMl).toBe(50);
    expect(urlsMl.every((u) => u.includes('/products/'))).toBe(true);
    expect(r.catalogos.slice(25).every((c) => c.produto?.estado === 'indisponivel' && c.ofertas?.estado === 'indisponivel')).toBe(true);
    expect(r.catalogos[49].ofertas).toEqual(IND_ORC);
    expect(r.vendedores.every((v) => v.estado === 'indisponivel')).toBe(true);
    expect(db.get(CHAVE_ML)).toBe(1000);

    // 1 catálogo: limite superior 4 (produto + ofertas + perfil + comissão), concedidas 3
    db.clear(); comandos = []; urlsMl = [];
    db.set(CHAVE_ML, 997);
    const um = await run(pagina(1));
    expect(urlsMl).toHaveLength(3);
    expect(um.vendedores).toMatchObject([{ estado: 'ok' }]);
    expect(exatasDe(um.catalogos[0])[0].comissaoNaSuaConta).toEqual(IND_ORC);
  });

  it('429 numa família: para de despachar só aquela família, mantém o que já chegou, sem retry', async () => {
    const p = pagina(20);
    for (let i = 0; i < 20; i++) respostasMl.set(`${ML}/products/MLB${1000 + i}`, { status: 429, corpo: null });
    const r = await run(p);
    // 1ª leva: 8 /products + 8 /items; depois do 429 nenhum /products novo
    expect(contar('/items?')).toBe(20);
    expect(urlsMl.filter((u) => /\/products\/MLB\d+$/.test(u))).toHaveLength(8);
    expect(r.catalogos.every((c) => JSON.stringify(c.produto) === JSON.stringify(IND_ML))).toBe(true);
    expect(r.catalogos.every((c) => c.ofertas?.estado === 'ok')).toBe(true);
    expect(r.vendedores.every((v) => v.estado === 'ok')).toBe(true);
    expect(new Set(urlsMl).size).toBe(urlsMl.length);
  });

  it('429 em listing_prices: comissão indisponível, perfis entregues', async () => {
    const p = pagina(10);
    for (let i = 0; i < 10; i++) respostasMl.set(urlLp(10 + i), { status: 429, corpo: null });
    const r = await run(p);
    expect(contar('listing_prices')).toBe(4); // só a 1ª leva do sublimite
    expect(r.catalogos.flatMap((c) => exatasDe(c)).map((e) => e.comissaoNaSuaConta)).toEqual(Array(10).fill(IND_ML));
    expect(r.vendedores.every((v) => v.estado === 'ok')).toBe(true);
  });

  it('deadline de 8 s desde a entrada: timeout por GET ≤ 3 s e limitado pelo restante; depois, sem despacho', async () => {
    extra.prazo = AGORA.getTime() + 8000;
    aoChamar = () => { agoraMs += 1000; };
    const r = await run(pedido(Array.from({ length: 10 }, (_, i) => cat(`MLB${i + 1}`, [], ['produto']))));
    expect(timeouts).toEqual([3000, 3000, 3000, 3000, 3000, 2500, 1500, 500]);
    expect(r.catalogos.slice(8).map((c) => c.produto)).toEqual([IND_TEMPO, IND_TEMPO]);
    expect(comandos.at(-1)).toEqual(['DECRBY', CHAVE_ML, 2]);
  });

  it('prazo já na entrada da edge (autenticação lenta): conta a partir dele, não do início da execução', async () => {
    extra.prazo = AGORA.getTime() + 1000; // 7 s gastos antes de chegar aqui
    const r = await run(pedido([cat('MLB1', [], ['produto'])]));
    expect(timeouts).toEqual([500]);
    expect(r.catalogos[0].produto).toEqual({ estado: 'indisponivel', motivo: 'catálogo indisponível' });
  });

  it('sem prazo explícito: 8 s a partir do início da execução', async () => {
    aoChamar = () => { agoraMs += 2000; };
    await run(pedido(Array.from({ length: 5 }, (_, i) => cat(`MLB${i + 1}`, [], ['produto']))));
    expect(timeouts).toEqual([3000, 3000, 3000, 1500]);
  });

  it('cancelamento: nenhum despacho novo depois do abort; o resto fica indisponível', async () => {
    const ctl = new AbortController();
    extra.sinal = ctl.signal;
    let n = 0;
    aoChamar = () => { if (++n === 3) ctl.abort(); };
    const r = await run(pedido(Array.from({ length: 6 }, (_, i) => cat(`MLB${i + 1}`, [], ['produto']))));
    expect(urlsMl).toHaveLength(3);
    expect(r.catalogos.slice(3).map((c) => c.produto)).toEqual(Array(3).fill({ estado: 'indisponivel', motivo: 'consulta cancelada' }));
  });

  it('virada do minuto UTC: devolve o saldo na chave antiga, re-reserva na nova, custo contado', async () => {
    agoraMs = new Date('2026-11-03T14:05:59.500Z').getTime();
    aoChamar = () => { agoraMs += 200; };
    for (let i = 1; i <= 5; i++) respostasMl.set(`${ML}/products/MLB${i}`, ok({ date_created: '2024-01-02T00:00:00Z' }));
    const r = await run(pedido(Array.from({ length: 5 }, (_, i) => cat(`MLB${i + 1}`, [], ['produto']))));
    expect(urlsMl).toHaveLength(5);
    expect(r.catalogos.every((c) => c.produto?.estado === 'ok')).toBe(true);
    expect(db.get(CHAVE_ML)).toBe(3);
    expect(db.get('ext:mlapp:202611031406')).toBe(2);
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY', 'EXPIRE', 'DECRBY', 'INCRBY', 'EXPIRE']);
    expect(r.custo.comandosRedis).toBe(comandos.length);
  });
});

describe('cota de páginas e Redis', () => {
  it('20 páginas por minuto por usuário+org; a 21ª é recusada sem ML nem orçamento; outro usuário/org segue', async () => {
    respostasMl.set(`${ML}/products/MLB1`, ok({ date_created: '2024-01-02T00:00:00Z' }));
    const p = pedido([cat('MLB1', [], ['produto'])], { perfis: [9] });
    for (let i = 0; i < 20; i++) expect((await run(p)).catalogos[0].estado).toBe('ok');
    comandos = []; urlsMl = [];
    const r = await run(p);
    expect(r.catalogos).toEqual([{ catalogProductId: 'MLB1', estado: 'indisponivel', motivo: 'limite de páginas por minuto', retomarEm: null, consultadoEm: null }]);
    expect(r.vendedores).toEqual([{ sellerId: 9, estado: 'indisponivel', motivo: 'limite de páginas por minuto' }]);
    expect(urlsMl).toEqual([]);
    expect(comandos).toEqual([['INCRBY', CHAVE_PAG, 1]]);
    expect(r.custo).toEqual({ comandosRedis: 1, chamadasMl: 0 });
    expect((await run(p, 'org1', 'u2')).catalogos[0].estado).toBe('ok');
    expect((await run(p, 'org2', 'u1')).catalogos[0].estado).toBe('ok');
  });

  it('Redis fora: cota fail-closed, nada vai ao ML', async () => {
    redisFora = true;
    const r = await run(pedido([cat('MLB1')]));
    expect(urlsMl).toEqual([]);
    expect(r.catalogos[0]).toEqual({ catalogProductId: 'MLB1', estado: 'indisponivel', motivo: 'serviço indisponível agora', retomarEm: null, consultadoEm: null });
  });

  it('Redis inválido só no orçamento global: nenhum despacho (fail-closed), página indisponível', async () => {
    falharPrefixo = 'ext:mlapp:';
    const r = await run(pagina(3));
    expect(urlsMl).toEqual([]);
    expect(r.catalogos.every((c) => JSON.stringify(c.produto) === JSON.stringify(IND_ORC) && JSON.stringify(c.ofertas) === JSON.stringify(IND_ORC))).toBe(true);
    expect(r.custo.chamadasMl).toBe(0);
  });

  it('orçamento global esgotado: zero chamadas ML', async () => {
    db.set(CHAVE_ML, 1000);
    const r = await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }])]));
    expect(urlsMl).toEqual([]);
    expect(r.catalogos[0]).toMatchObject({ estado: 'ok', produto: IND_ORC, ofertas: IND_ORC });
    expect(db.get(CHAVE_ML)).toBe(1000);
  });
});

describe('comissão: chave existente, um MGET por página, nenhum SET', () => {
  it('um MGET com chaves deduplicadas; hit não chama listing_prices; miss é calculado e só devolvido', async () => {
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
    const ex = exatasDe(r.catalogos[0]).map((e) => e.comissaoNaSuaConta);
    expect(ex[0]).toEqual(hit);
    expect(ex[1]).toMatchObject({ estado: 'ok', valor: { saleFeeAmount: 12, precoConsultado: 20 } });
    expect(ex[2]).toMatchObject({ estado: 'indisponivel' });
    expect(ops()).not.toContain('SET');
  });

  it('valor inválido no cache = miss', async () => {
    db.set(chaveComissao(CONTA, 'MLB5', 'gold_special', 10), '{lixo');
    respostasMl.set(`${ML}/products/MLB1/items?limit=100`, ofertas([oferta('MLB10', 7)]));
    respostasMl.set(urlLp(10), ok(LP_OK));
    await run(pedido([cat('MLB1', [{ itemId: 'MLB10', preco: 10 }], ['ofertas'])], { perfisEmCache: [7] }));
    expect(urlsMl.filter((u) => u.includes('listing_prices'))).toHaveLength(1);
  });

  it('comissão quente e perfis no navegador: só INCRBY/EXPIRE/MGET/DECRBY, sem GET/SET', async () => {
    const ids = ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5'];
    for (const [i, id] of ids.entries()) {
      respostasMl.set(`${ML}/products/${id}`, ok({ date_created: '2024-01-02T00:00:00Z' }));
      respostasMl.set(`${ML}/products/${id}/items?limit=100`, ofertas([oferta(`${id}0`, 7 + i)]));
      db.set(chaveComissao(CONTA, 'MLB5', 'gold_special', 10 + i), JSON.stringify({ estado: 'ok', valor: { percentual: 12, fixa: 0 } }));
    }
    const r = await run(pedido(ids.map((id, i) => cat(id, [{ itemId: `${id}0`, preco: 10 + i }])), { perfisEmCache: [7, 8, 9, 10, 11] }));
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY', 'EXPIRE', 'MGET', 'DECRBY']);
    expect(r.custo).toEqual({ comandosRedis: comandos.length, chamadasMl: 10 });
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
    const lim = status === 429;
    expect(r.catalogos[0].produto).toEqual(lim ? IND_ML : { estado: 'indisponivel', motivo: 'catálogo indisponível' });
    expect(r.catalogos[1].ofertas).toEqual(lim ? IND_ML : { estado: 'indisponivel', motivo: 'ofertas indisponíveis' });
    expect(r.vendedores[0]).toEqual({ sellerId: 7, ...(lim ? IND_ML : { estado: 'indisponivel', motivo: 'perfil indisponível' }) });
    expect(exatasDe(r.catalogos[2])[0].comissaoNaSuaConta).toEqual(lim ? IND_ML : { estado: 'indisponivel', motivo: 'comissão indisponível' });
    // uma tentativa por chamada; todas contam no orçamento
    expect(urlsMl).toHaveLength(5);
    expect(r.custo.chamadasMl).toBe(5);
    expect(ops()).not.toContain('SET');
  });
});
