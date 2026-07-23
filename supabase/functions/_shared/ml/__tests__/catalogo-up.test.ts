import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseElegibilidadeItem,
  montarBodyOptinItem,
  vincularItensCatalogoUP,
  type ItemCatalogoRow,
} from '../catalogo';

// ── parser da elegibilidade de um item SEM variações (status na RAIZ do JSON) ──
describe('parseElegibilidadeItem — item sem variações (User Products)', () => {
  it('lê status/buy_box/reason da RAIZ do JSON', () => {
    const e = parseElegibilidadeItem(
      { id: 'MLB1', status: 'READY_FOR_OPTIN', buy_box_eligible: true }, 'MLB1',
    );
    expect(e).toEqual({ id: 'MLB1', status: 'READY_FOR_OPTIN', buy_box_eligible: true, reason: null });
  });

  it('variations:[] presente mas vazio → NÃO tenta indexar, lê a raiz mesmo assim', () => {
    const e = parseElegibilidadeItem(
      { id: 'MLB1', status: 'READY_FOR_OPTIN', buy_box_eligible: true, variations: [] }, 'MLB1',
    );
    expect(e?.status).toBe('READY_FOR_OPTIN');
    expect(e?.id).toBe('MLB1'); // id vem do itemId, não de variations
  });

  it('sem status na raiz (ainda computando) → undefined (pendente)', () => {
    expect(parseElegibilidadeItem({ id: 'MLB1', variations: [] }, 'MLB1')).toBeUndefined();
    expect(parseElegibilidadeItem(null, 'MLB1')).toBeUndefined();
  });

  it('FAMILY_DIFF na raiz → EligVar com o status', () => {
    const e = parseElegibilidadeItem({ status: 'FAMILY_DIFF', buy_box_eligible: false, reason: 'x' }, 'MLB1');
    expect(e).toEqual({ id: 'MLB1', status: 'FAMILY_DIFF', buy_box_eligible: false, reason: 'x' });
  });
});

describe('montarBodyOptinItem — POST sem variation_id', () => {
  it('monta { item_id, catalog_product_id } e NUNCA inclui variation_id', () => {
    const body = montarBodyOptinItem('MLB123', 'MLB28853753');
    expect(body).toEqual({ item_id: 'MLB123', catalog_product_id: 'MLB28853753' });
    expect('variation_id' in body).toBe(false);
  });
});

// ── orquestrador: itera ITENS (cada cor é seu próprio item_id no ML) ──
const API = 'https://api.mercadolibre.com';

// `failIds`: simula update que falha no banco pra um id específico (revisão v2, achado ALTA #2 —
// depois do opt-in remoto funcionar, a persistência precisa ser CONFIRMADA antes de contar sucesso).
function fakeAdmin(opts: { failIds?: unknown[] } = {}) {
  const writes: Array<{ id: unknown; values: Record<string, unknown> }> = [];
  const fail = new Set(opts.failIds ?? []);
  const admin = {
    from: (_t: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, id: unknown) => {
          writes.push({ id, values });
          if (fail.has(id)) return Promise.resolve({ error: { message: 'update falhou' } });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { admin: admin as never, writes };
}

/** Stub de fetch por URL+método. eligibility/ficha/atributos por item; POST de opt-in. */
function stubFetch(opts: {
  elig?: Record<string, unknown>;             // resposta de /catalog_listing_eligibility (raiz)
  ficha?: Record<string, unknown> | null;     // resposta de /products/search
  length?: string | null;                     // LENGTH do nosso item (trava de metragem)
  optinId?: string;                           // id devolvido pelo POST
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
    if (url.includes('/catalog_listing_eligibility')) return ok(opts.elig ?? {});
    if (url.includes('/products/search')) return ok(opts.ficha === null ? { results: [] } : { results: [opts.ficha] });
    if (url.includes('/items/catalog_listings')) return ok({ id: opts.optinId ?? 'MLB-LISTING-1' });
    if (url.match(/\/items\/[^/]+\?/)) return ok({ attributes: opts.length ? [{ id: 'LENGTH', value_name: opts.length }] : [] });
    return ok({});
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const READY = { status: 'READY_FOR_OPTIN', buy_box_eligible: true };
const FICHA_UNIDADE = { id: 'MLB-PROD-1', attributes: [{ id: 'SALE_FORMAT', value_name: 'Unidade' }] };
const FICHA_KIT = { id: 'MLB-PROD-KIT', attributes: [{ id: 'UNITS_PER_PACK', value_name: '5' }] };

function filho(over: Partial<ItemCatalogoRow> = {}): ItemCatalogoRow {
  return {
    id: 'item-1', item_externo_id: 'MLB-ITEM-1', gtin: '7891234567890',
    catalog_product_id: null, catalog_listing_id: null, ...over,
  };
}

describe('vincularItensCatalogoUP — vinculação por item (não por variação)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('READY + buy_box + ficha equivalente → opt-in feito, catalog_status=vinculado no filho certo', async () => {
    stubFetch({ elig: READY, ficha: FICHA_UNIDADE, optinId: 'MLB-LISTING-99' });
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularItensCatalogoUP('tok', admin, [filho({ id: 'item-verde' })]);
    expect(resumo.vinculado).toBe(1);
    const vinc = writes.find((w) => w.values.catalog_status === 'vinculado');
    expect(vinc?.id).toBe('item-verde');
    expect(vinc?.values.catalog_listing_id).toBe('MLB-LISTING-99');
  });

  it('ficha de KIT (UNITS_PER_PACK>1) → ficha_divergente, SEM POST de opt-in', async () => {
    const calls = stubFetch({ elig: READY, ficha: FICHA_KIT });
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularItensCatalogoUP('tok', admin, [filho()]);
    expect(resumo.ficha_divergente).toBe(1);
    expect(resumo.vinculado).toBe(0);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    // (o 1º write de item-1 é o catalog_product_id resolvido; o status vem no write seguinte)
    expect(writes.find((w) => w.id === 'item-1' && 'catalog_status' in w.values)?.values.catalog_status).toBe('ficha_divergente');
  });

  it('filho já com catalog_listing_id → pula, ZERO chamada de rede', async () => {
    const calls = stubFetch({ elig: READY, ficha: FICHA_UNIDADE });
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularItensCatalogoUP('tok', admin, [filho({ catalog_listing_id: 'MLB-JA' })]);
    expect(resumo.pulou).toBe(1);
    expect(calls.length).toBe(0);
    expect(writes.length).toBe(0);
  });

  it('filho sem GTIN resolvível → não vincula, SEM crash, NÃO conta como erro', async () => {
    stubFetch({ elig: READY, ficha: null }); // sem gtin → products/search vazio
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularItensCatalogoUP('tok', admin, [filho({ gtin: null })]);
    expect(resumo.erro).toBe(0);
    expect(resumo.vinculado).toBe(0);
    expect(resumo.sem_produto).toBe(1); // mesmo bucket "sem dado suficiente" do Legacy
    expect(writes.find((w) => w.id === 'item-1')?.values.catalog_status).toBe('sem_produto');
  });

  it('filho sem item_externo_id (não existe no ML) → conta como pendente (retentável), NÃO como sem-match', async () => {
    // Achado MÉDIA v1/v2: "sem variação" não faz sentido no modelo UP (não há variação), e o
    // branch antigo disparava um alerta de Telegram com texto incorreto pro caso UP. Item ainda
    // não criado é transitório (a fila reagenda), não um estado terminal sem-match.
    const calls = stubFetch({ elig: READY, ficha: FICHA_UNIDADE });
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularItensCatalogoUP('tok', admin, [filho({ item_externo_id: null })]);
    expect(resumo.pendente).toBe(1);
    expect(resumo.sem_variation_id).toBe(0);
    expect(resumo.erro).toBe(0);
    expect(calls.length).toBe(0);
    expect(writes.length).toBe(0); // nada a persistir ainda — o item nem existe no ML
  });

  // Revisão v2 (Codex, achado ALTA #2): opt-in funcionou no ML mas o UPDATE no banco falhou —
  // não pode contar como vinculado, senão a próxima rodada repete o opt-in (POST não-idempotente).
  it('opt-in funciona no ML mas persistência falha → NÃO conta como vinculado, conta como erro', async () => {
    stubFetch({ elig: READY, ficha: FICHA_UNIDADE, optinId: 'MLB-LISTING-99' });
    const { admin, writes } = fakeAdmin({ failIds: ['item-verde'] });
    // catalog_product_id já resolvido (= id da ficha): só o write final de 'vinculado' acontece,
    // isolando exatamente o passo que a revisão apontou como não-checado.
    const resumo = await vincularItensCatalogoUP('tok', admin, [filho({ id: 'item-verde', catalog_product_id: 'MLB-PROD-1' })]);
    expect(resumo.vinculado).toBe(0);
    expect(resumo.erro).toBe(1);
    expect(writes.some((w) => w.id === 'item-verde' && w.values.catalog_status === 'vinculado')).toBe(true);
  });
});
