// Item PLANO (ADR-0084): categoria que exige `family_name` publica 1 SKU como item sem
// `variations[]` — o próprio item É a variação única, e `variacoes.ml_variation_id` guarda o
// ml_item_id. O caminho Legacy lia a elegibilidade só de `body.variations[]`, que nesse item vem
// vazio: toda variação caía em `pendente` para sempre (32/32 casos em produção, o mais antigo com
// 17 dias). Estes testes travam o parse pela raiz e o body de opt-in sem `variation_id`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  indexarElegibilidadeAnuncio,
  montarBodyOptinVariacao,
  vincularVariacoesCatalogo,
  type VarCatalogoRow,
} from '../catalogo';

describe('indexarElegibilidadeAnuncio — cobre item com variações E item plano', () => {
  it('body com variations[] → indexa por variation_id (Legacy, inalterado)', () => {
    const m = indexarElegibilidadeAnuncio(
      { variations: [{ id: 123, status: 'READY_FOR_OPTIN', buy_box_eligible: true }] },
      'MLB999',
    );
    expect(m.get('123')?.status).toBe('READY_FOR_OPTIN');
    expect(m.has('MLB999')).toBe(false);
  });

  it('item plano (sem variations[], status na raiz) → indexa pelo item id', () => {
    const m = indexarElegibilidadeAnuncio(
      { id: 'MLB5001755829', status: 'READY_FOR_OPTIN', buy_box_eligible: true, variations: [] },
      'MLB5001755829',
    );
    expect(m.get('MLB5001755829')).toEqual({
      id: 'MLB5001755829', status: 'READY_FOR_OPTIN', buy_box_eligible: true, reason: null,
    });
  });

  it('sem variations[] e sem status na raiz (ainda computando) → mapa vazio → pendente', () => {
    expect(indexarElegibilidadeAnuncio({ id: 'MLB1', variations: [] }, 'MLB1').size).toBe(0);
    expect(indexarElegibilidadeAnuncio(null, 'MLB1').size).toBe(0);
  });
});

describe('montarBodyOptinVariacao — escolhe o body pelo formato do ml_variation_id', () => {
  it('id numérico (variação Legacy real) → body COM variation_id', () => {
    expect(montarBodyOptinVariacao('MLB6901096672', '203313876609', 'MLB28853753')).toEqual({
      item_id: 'MLB6901096672', variation_id: 203313876609, catalog_product_id: 'MLB28853753',
    });
  });

  it('id = o próprio item (plano) → body SEM variation_id (Number(...) seria NaN)', () => {
    const body = montarBodyOptinVariacao('MLB5001755829', 'MLB5001755829', 'MLB28853753');
    expect(body).toEqual({ item_id: 'MLB5001755829', catalog_product_id: 'MLB28853753' });
    expect('variation_id' in body).toBe(false);
  });
});

// ── integração: o orquestrador Legacy precisa vincular um item plano de ponta a ponta ──
const READY_RAIZ = { id: 'MLB-PLANO', status: 'READY_FOR_OPTIN', buy_box_eligible: true, variations: [] };
const FICHA_UNIDADE = { id: 'MLB-PROD-1', attributes: [{ id: 'SALE_FORMAT', value_name: 'Unidade' }] };

function fakeAdmin() {
  const writes: Array<{ id: unknown; values: Record<string, unknown> }> = [];
  const admin = {
    from: (_t: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, id: unknown) => {
          writes.push({ id, values });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { admin: admin as never, writes };
}

function stubFetch(opts: { elig: Record<string, unknown>; ficha?: Record<string, unknown> | null }) {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
    if (url.includes('/catalog_listing_eligibility')) return ok(opts.elig);
    if (url.includes('/products/search')) return ok(opts.ficha === null ? { results: [] } : { results: [opts.ficha ?? FICHA_UNIDADE] });
    if (url.includes('/items/catalog_listings')) {
      posts.push(JSON.parse(String(init?.body ?? '{}')));
      return ok({ id: 'MLB-LISTING-PLANO' });
    }
    return ok({ attributes: [] });
  }));
  return posts;
}

function varPlana(over: Partial<VarCatalogoRow> = {}): VarCatalogoRow {
  return {
    id: 'var-1', codigo: '00000023', gtin: '609963220755',
    ml_variation_id: 'MLB-PLANO', catalog_product_id: null, catalog_listing_id: null, ...over,
  };
}

describe('vincularVariacoesCatalogo — item plano', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('READY na raiz + ficha equivalente → vincula (antes ficava pendente para sempre)', async () => {
    const posts = stubFetch({ elig: READY_RAIZ });
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularVariacoesCatalogo('tok', admin, 'MLB-PLANO', [varPlana()]);
    expect(resumo.vinculado).toBe(1);
    expect(resumo.pendente).toBe(0);
    expect(posts[0]).toEqual({ item_id: 'MLB-PLANO', catalog_product_id: 'MLB-PROD-1' });
    expect(writes.find((w) => w.values.catalog_status === 'vinculado')?.values.catalog_listing_id)
      .toBe('MLB-LISTING-PLANO');
  });

  it('item plano ainda sem status na raiz → segue pendente (retentável)', async () => {
    stubFetch({ elig: { id: 'MLB-PLANO', variations: [] } });
    const { admin } = fakeAdmin();
    const resumo = await vincularVariacoesCatalogo('tok', admin, 'MLB-PLANO', [varPlana()]);
    expect(resumo.pendente).toBe(1);
  });
});
