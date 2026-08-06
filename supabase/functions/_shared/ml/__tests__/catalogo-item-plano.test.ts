// Item PLANO (ADR-0084): categoria que exige `family_name` publica 1 SKU como item sem
// `variations[]` — o próprio item É a variação única, e `variacoes.ml_variation_id` guarda o
// ml_item_id. O caminho Legacy lia a elegibilidade só de `body.variations[]`, que nesse item vem
// vazio: toda variação caía em `pendente` para sempre (32/32 casos em produção, o mais antigo com
// 17 dias). Estes testes travam o parse pela raiz e o body de opt-in sem `variation_id`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  indexarElegibilidadeAnuncio,
  montarBodyOptinVariacao,
  podeTentarOptin,
  decidirAcaoCatalogo,
  fichaEquivalente,
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

// Validado com token real em 2026-08-06 (MLB5001755829, ficha MLB36209242): a elegibilidade de um
// item plano volta `CATALOG_PRODUCT_ID_NULL` + `buy_box_eligible:false`, e mesmo assim o
// `POST /items/catalog_listings` é aceito e cria o anúncio de catálogo. O status só diz que o item
// ainda não tem ficha associada — que é exatamente o que o opt-in resolve.
describe('podeTentarOptin — quais status permitem o POST de opt-in', () => {
  it('READY_FOR_OPTIN exige buy_box_eligible', () => {
    expect(podeTentarOptin({ id: 1, status: 'READY_FOR_OPTIN', buy_box_eligible: true })).toBe(true);
    expect(podeTentarOptin({ id: 1, status: 'READY_FOR_OPTIN', buy_box_eligible: false })).toBe(false);
  });

  it('CATALOG_PRODUCT_ID_NULL permite opt-in mesmo sem buy_box (validado com token real)', () => {
    expect(podeTentarOptin({
      id: 'MLB5001755829', status: 'CATALOG_PRODUCT_ID_NULL',
      buy_box_eligible: false, reason: 'item_catalog_product_id_null',
    })).toBe(true);
  });

  it('PRODUCT_INACTIVE também permite opt-in (validado: MLB4982690837 → MLB7343614472)', () => {
    expect(podeTentarOptin({
      id: 'MLB4982690837', status: 'PRODUCT_INACTIVE',
      buy_box_eligible: false, reason: 'parent_product_v0_domain',
    })).toBe(true);
  });

  it('demais status e ausência de elegibilidade → não tenta', () => {
    expect(podeTentarOptin({ id: 1, status: 'FAMILY_DIFF', buy_box_eligible: false })).toBe(false);
    expect(podeTentarOptin({ id: 1, status: 'NOT_ELIGIBLE' })).toBe(false);
    expect(podeTentarOptin(undefined)).toBe(false);
  });
});

// A trava anti-kit do ADR-0021 (incidente 2026-06-15) assumia que TODO produto nosso é 1 unidade
// avulsa. Falso quando o próprio produto é um kit: o "Aquaphor Duo Pack 2 Unidades"
// (GTIN 4005800220012) tem ficha `SALE_FORMAT=Kit`/`UNITS_PER_PACK=2` — idêntica ao item, que
// declara Kit/2 — e seria reprovada como se fosse a ficha-kit errada do incidente das fitas.
// A comparação passa a ser contra o que o NOSSO item declara; sem declaração, segue "1 unidade".
describe('fichaEquivalente — kit legítimo vs. ficha-kit errada', () => {
  const kit = (n: number) => ({ id: 'MLB-F', saleFormat: 'Kit', unitsPerPack: n, lengthM: null });

  it('nosso item é Kit/2 e a ficha é Kit/2 → equivalente', () => {
    expect(fichaEquivalente(kit(2), { lengthM: null, unitsPerPack: 2, saleFormat: 'Kit' }).ok).toBe(true);
  });

  it('nosso item é Kit/2 mas a ficha é Kit/5 → reprova', () => {
    const r = fichaEquivalente(kit(5), { lengthM: null, unitsPerPack: 2, saleFormat: 'Kit' });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('kit');
  });

  it('nosso item não declara nada (fitas) + ficha de kit → reprova, como antes do fix', () => {
    expect(fichaEquivalente(kit(5), { lengthM: null }).ok).toBe(false);
    expect(fichaEquivalente(kit(2), { lengthM: null }).ok).toBe(false);
  });

  it('nosso item é Unidade e a ficha é Unidade → equivalente', () => {
    expect(fichaEquivalente(
      { id: 'MLB-F', saleFormat: 'Unidade', unitsPerPack: 1, lengthM: null },
      { lengthM: null, unitsPerPack: 1, saleFormat: 'Unidade' },
    ).ok).toBe(true);
  });
});

describe('decidirAcaoCatalogo — item plano', () => {
  const CPN = { id: 'MLB1', status: 'CATALOG_PRODUCT_ID_NULL', buy_box_eligible: false };

  it('CATALOG_PRODUCT_ID_NULL + ficha equivalente → optin', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB36209242' }, CPN, { ok: true, motivo: null }))
      .toBe('optin');
  });

  it('CATALOG_PRODUCT_ID_NULL sem ficha casada → sem_produto', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: null }, CPN)).toBe('sem_produto');
  });

  it('CATALOG_PRODUCT_ID_NULL + ficha de kit → ficha_divergente (trava do ADR-0021 mantida)', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB-KIT' }, CPN, { ok: false, motivo: 'ficha_kit_5un' }))
      .toBe('ficha_divergente');
  });

  it('ALREADY_OPTED_IN → ja_vinculado (não é falha de elegibilidade)', () => {
    expect(decidirAcaoCatalogo(
      { catalogListingId: null, catalogProductId: 'MLB1' },
      { id: 'MLB1', status: 'ALREADY_OPTED_IN', buy_box_eligible: false, reason: 'item_has_item_relations' },
    )).toBe('ja_vinculado');
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

function stubFetch(opts: { elig: Record<string, unknown>; ficha?: Record<string, unknown> | null; relacionado?: string }) {
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
    if (url.includes('item_relations')) return ok({ item_relations: opts.relacionado ? [{ id: opts.relacionado }] : [] });
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

  it('CATALOG_PRODUCT_ID_NULL (item plano recém-publicado) → opt-in, não pendente/nao_elegivel', async () => {
    const posts = stubFetch({
      elig: { id: 'MLB-PLANO', status: 'CATALOG_PRODUCT_ID_NULL', buy_box_eligible: false, reason: 'item_catalog_product_id_null', variations: [] },
    });
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularVariacoesCatalogo('tok', admin, 'MLB-PLANO', [varPlana()]);
    expect(resumo.vinculado).toBe(1);
    expect(resumo.nao_elegivel).toBe(0);
    expect(posts[0]).toEqual({ item_id: 'MLB-PLANO', catalog_product_id: 'MLB-PROD-1' });
    expect(writes.find((w) => w.values.catalog_status === 'vinculado')).toBeTruthy();
  });

  it('ALREADY_OPTED_IN → vinculado com o listing id lido de item_relations, SEM novo POST', async () => {
    const posts = stubFetch({
      elig: { id: 'MLB-PLANO', status: 'ALREADY_OPTED_IN', buy_box_eligible: false, reason: 'item_has_item_relations', variations: [] },
      relacionado: 'MLB-JA-VINCULADO',
    });
    const { admin, writes } = fakeAdmin();
    const resumo = await vincularVariacoesCatalogo('tok', admin, 'MLB-PLANO', [varPlana()]);
    expect(resumo.vinculado).toBe(1);
    expect(resumo.nao_elegivel).toBe(0);
    expect(posts.length).toBe(0);
    expect(writes.find((w) => w.values.catalog_status === 'vinculado')?.values.catalog_listing_id)
      .toBe('MLB-JA-VINCULADO');
  });

  it('item plano ainda sem status na raiz → segue pendente (retentável)', async () => {
    stubFetch({ elig: { id: 'MLB-PLANO', variations: [] } });
    const { admin } = fakeAdmin();
    const resumo = await vincularVariacoesCatalogo('tok', admin, 'MLB-PLANO', [varPlana()]);
    expect(resumo.pendente).toBe(1);
  });
});
