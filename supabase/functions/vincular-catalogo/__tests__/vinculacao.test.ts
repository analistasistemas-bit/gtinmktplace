import { describe, it, expect, vi } from 'vitest';
import {
  resolverGtinFilho,
  carregarFilhosCatalogoUP,
  rodarVinculacaoCatalogo,
} from '../vinculacao';

// Fake admin configurável por tabela; cada query é thenable e devolve o dataset da tabela.
// Aplica eq/in genericamente contra as próprias colunas da linha (não hardcoded por nome de
// coluna) — necessário pra testar filtro real (partição, org) e não só o formato dos dados.
// `errors` simula uma query que falha (Codex, revisão v2 achado #1): confirma que erro de banco
// propaga em vez de virar silenciosamente uma lista vazia.
function fakeAdmin(data: {
  anuncios_externos?: Record<string, unknown>[];
  anuncios_externos_itens?: Record<string, unknown>[];
  variacoes?: Record<string, unknown>[];
  errors?: Partial<Record<'anuncios_externos' | 'anuncios_externos_itens' | 'variacoes', { message: string }>>;
}) {
  function chain(table: string) {
    const filters: Array<{ col: string; op: 'eq' | 'in'; val: unknown }> = [];
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { filters.push({ col: c, op: 'eq', val: v }); return api; },
      in: (c: string, v: unknown) => { filters.push({ col: c, op: 'in', val: v }); return api; },
      then: (resolve: (v: unknown) => unknown) => {
        const err = data.errors?.[table as keyof typeof data.errors];
        if (err) return Promise.resolve({ data: null, error: err }).then(resolve);
        let rows = (data[table as keyof typeof data] ?? []) as Record<string, unknown>[];
        for (const f of filters) {
          rows = rows.filter((r) => (f.op === 'eq' ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col])));
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  }
  return { from: chain } as never;
}

describe('resolverGtinFilho — GTIN via join com variacoes (por variacao_id, fallback por sku)', () => {
  const porId = new Map<string, string | null>([['var-1', '111']]);
  const porSku = new Map<string, string | null>([['SKU-A', '222']]);

  it('usa variacao_id quando presente no mapa', () => {
    expect(resolverGtinFilho({ variacao_id: 'var-1', sku: 'SKU-A' }, porId, porSku)).toBe('111');
  });
  it('fallback por sku quando variacao_id nulo', () => {
    expect(resolverGtinFilho({ variacao_id: null, sku: 'SKU-A' }, porId, porSku)).toBe('222');
  });
  it('fallback por sku quando variacao_id órfão (não está no mapa)', () => {
    expect(resolverGtinFilho({ variacao_id: 'var-orfa', sku: 'SKU-A' }, porId, porSku)).toBe('222');
  });
  it('sem match nenhum → null', () => {
    expect(resolverGtinFilho({ variacao_id: null, sku: 'SKU-X' }, porId, porSku)).toBeNull();
  });
});

describe('carregarFilhosCatalogoUP', () => {
  const FAMILIA = { id: 'fam-1', org_id: 'org-1', codigo_pai: '03103331', ml_item_id: 'MLB-REP' };
  const raiz = (id: string, particao = 0) => ({ id, org_id: FAMILIA.org_id, codigo_pai: FAMILIA.codigo_pai, canal: 'mercado_livre', particao });

  it('família UP: junta itens filhos não-retirados com gtin+cor resolvidos por variacao', async () => {
    const admin = fakeAdmin({
      anuncios_externos: [raiz('root-1')],
      anuncios_externos_itens: [
        { id: 'i1', anuncio_externo_id: 'root-1', item_externo_id: 'MLB-A', variacao_id: 'v1', sku: 'SKU-A', retirado: false, catalog_product_id: null, catalog_listing_id: null },
        { id: 'i2', anuncio_externo_id: 'root-1', item_externo_id: 'MLB-B', variacao_id: null, sku: 'SKU-B', retirado: false, catalog_product_id: null, catalog_listing_id: null },
        { id: 'i3', anuncio_externo_id: 'root-1', item_externo_id: 'MLB-C', variacao_id: 'v3', sku: 'SKU-C', retirado: true, catalog_product_id: null, catalog_listing_id: null },
      ],
      variacoes: [
        { id: 'v1', familia_id: FAMILIA.id, codigo: 'SKU-A', gtin: '111', cor: 'Verde' },
        { id: 'v9', familia_id: FAMILIA.id, codigo: 'SKU-B', gtin: '222', cor: 'Azul' },
      ],
    });
    const filhos = await carregarFilhosCatalogoUP(admin, {
      orgId: FAMILIA.org_id, codigoPai: FAMILIA.codigo_pai, canal: 'mercado_livre', familiaId: FAMILIA.id,
    });
    expect(filhos.map((f) => f.id)).toEqual(['i1', 'i2']); // i3 retirado fora
    expect(filhos.find((f) => f.id === 'i1')).toMatchObject({ gtin: '111', cor: 'Verde' });
    expect(filhos.find((f) => f.id === 'i2')).toMatchObject({ gtin: '222', cor: 'Azul' }); // resolvido por sku
  });

  it('família Legacy: sem linhas em anuncios_externos_itens → []', async () => {
    const admin = fakeAdmin({ anuncios_externos: [raiz('root-1')], anuncios_externos_itens: [] });
    const filhos = await carregarFilhosCatalogoUP(admin, {
      orgId: FAMILIA.org_id, codigoPai: FAMILIA.codigo_pai, canal: 'mercado_livre', familiaId: FAMILIA.id,
    });
    expect(filhos).toEqual([]);
  });

  it('sem raiz em anuncios_externos → [] (não consulta itens)', async () => {
    const admin = fakeAdmin({ anuncios_externos: [] });
    const filhos = await carregarFilhosCatalogoUP(admin, {
      orgId: FAMILIA.org_id, codigoPai: FAMILIA.codigo_pai, canal: 'mercado_livre', familiaId: FAMILIA.id,
    });
    expect(filhos).toEqual([]);
  });

  // Codex (revisão v2, achado #1): erro de query não pode virar silenciosamente "família é Legacy".
  it('erro na query de raízes propaga (NÃO vira [])', async () => {
    const admin = fakeAdmin({ errors: { anuncios_externos: { message: 'timeout raizes' } } });
    await expect(carregarFilhosCatalogoUP(admin, {
      orgId: FAMILIA.org_id, codigoPai: FAMILIA.codigo_pai, canal: 'mercado_livre', familiaId: FAMILIA.id,
    })).rejects.toThrow(/timeout raizes/);
  });

  it('erro na query de itens propaga (NÃO vira [])', async () => {
    const admin = fakeAdmin({
      anuncios_externos: [raiz('root-1')],
      errors: { anuncios_externos_itens: { message: 'conn reset itens' } },
    });
    await expect(carregarFilhosCatalogoUP(admin, {
      orgId: FAMILIA.org_id, codigoPai: FAMILIA.codigo_pai, canal: 'mercado_livre', familiaId: FAMILIA.id,
    })).rejects.toThrow(/conn reset itens/);
  });

  // Achado #3 (v1/v2): schema modela múltiplas partições da mesma família (split, ainda não
  // integrado) — a query da raiz precisa travar em partição 0 pra não misturar filhos de
  // partições diferentes no dia em que o split for wireado.
  it('só considera a partição 0 — não mistura filhos de outra partição', async () => {
    const admin = fakeAdmin({
      anuncios_externos: [raiz('root-p0', 0), raiz('root-p1', 1)],
      anuncios_externos_itens: [
        { id: 'i-p0', anuncio_externo_id: 'root-p0', item_externo_id: 'MLB-P0', variacao_id: null, sku: 'SKU-P0', retirado: false, catalog_product_id: null, catalog_listing_id: null },
        { id: 'i-p1', anuncio_externo_id: 'root-p1', item_externo_id: 'MLB-P1', variacao_id: null, sku: 'SKU-P1', retirado: false, catalog_product_id: null, catalog_listing_id: null },
      ],
    });
    const filhos = await carregarFilhosCatalogoUP(admin, {
      orgId: FAMILIA.org_id, codigoPai: FAMILIA.codigo_pai, canal: 'mercado_livre', familiaId: FAMILIA.id,
    });
    expect(filhos.map((f) => f.id)).toEqual(['i-p0']);
  });
});

describe('rodarVinculacaoCatalogo — roteamento UP vs Legacy (regressão)', () => {
  const FAMILIA = { id: 'fam-1', org_id: 'org-1', codigo_pai: '03103331', ml_item_id: 'MLB-REP' };
  const raiz = (id: string, particao = 0) => ({ id, org_id: FAMILIA.org_id, codigo_pai: FAMILIA.codigo_pai, canal: 'mercado_livre', particao });

  it('família UP (tem filhos) → roteia pro caminho novo (vincularUP), NUNCA Legacy', async () => {
    const admin = fakeAdmin({
      anuncios_externos: [raiz('root-1')],
      anuncios_externos_itens: [{ id: 'i1', anuncio_externo_id: 'root-1', item_externo_id: 'MLB-A', variacao_id: 'v1', sku: 'SKU-A', retirado: false, catalog_product_id: null, catalog_listing_id: null }],
      variacoes: [{ id: 'v1', familia_id: FAMILIA.id, codigo: 'SKU-A', gtin: '111', cor: 'Verde' }],
    });
    const vincularUP = vi.fn().mockResolvedValue({ vinculado: 1, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 });
    const vincularLegacy = vi.fn();
    const r = await rodarVinculacaoCatalogo(admin, 'tok', FAMILIA, 'mercado_livre', { vincularUP, vincularLegacy });
    expect(r.tipo).toBe('up');
    expect(vincularUP).toHaveBeenCalledOnce();
    expect(vincularLegacy).not.toHaveBeenCalled();
    // o item_externo_id (não o ml_variation_id) é a chave da vinculação UP
    expect(vincularUP.mock.calls[0][2][0]).toMatchObject({ id: 'i1', item_externo_id: 'MLB-A', gtin: '111' });
  });

  it('família Legacy (sem filhos) → segue EXATAMENTE como antes (vincularLegacy c/ ml_item_id+variacoes)', async () => {
    const admin = fakeAdmin({
      anuncios_externos: [raiz('root-1')],
      anuncios_externos_itens: [],
      variacoes: [{ id: 'v1', familia_id: FAMILIA.id, excluida_da_publicacao: false, codigo: 'SKU-A', gtin: '111', ml_variation_id: '900', catalog_product_id: null, catalog_listing_id: null }],
    });
    const vincularUP = vi.fn();
    const vincularLegacy = vi.fn().mockResolvedValue({ vinculado: 1, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 });
    const r = await rodarVinculacaoCatalogo(admin, 'tok', FAMILIA, 'mercado_livre', { vincularUP, vincularLegacy });
    expect(r.tipo).toBe('legacy');
    expect(vincularUP).not.toHaveBeenCalled();
    expect(vincularLegacy).toHaveBeenCalledOnce();
    expect(vincularLegacy.mock.calls[0][2]).toBe('MLB-REP'); // ml_item_id
    expect((vincularLegacy.mock.calls[0][3] as unknown[]).length).toBe(1); // as variacoes
  });

  it('Legacy sem variacoes → sem_variacoes (nada a vincular)', async () => {
    const admin = fakeAdmin({ anuncios_externos: [], variacoes: [] });
    const r = await rodarVinculacaoCatalogo(admin, 'tok', FAMILIA, 'mercado_livre', { vincularUP: vi.fn(), vincularLegacy: vi.fn() });
    expect(r.tipo).toBe('sem_variacoes');
  });
});
