import { describe, it, expect } from 'vitest';
import { reconciliarBackfill, type PortasBackfill, type FamiliaSemFilho, type ItemBackfillPorta } from '../reconciliar-backfill';

// ADR-0088 — Reconciliador de backfill: importa itens planos PRÉ-EXISTENTES (ADR-0084/0087, item
// plano numa categoria que exige family_name) pro modelo novo (N itens técnicos, ADR-0088). Só
// leitura remota (GET) — nenhum POST/PUT. Segunda execução sobre a mesma família → inseridos=0
// (a família já tem filho, sai de "sem filho" e não é revisitada).

const SELLER = 'seller-1';

function fakePortas(over: Partial<PortasBackfill> = {}): PortasBackfill & { upserts: Array<{ familia: FamiliaSemFilho; item: unknown }> } {
  const upserts: Array<{ familia: FamiliaSemFilho; item: unknown }> = [];
  return {
    upserts,
    listarFamiliasSemFilho: async () => [],
    buscarItem: async () => null,
    upsertRaizEFilho: async (familia, item) => { upserts.push({ familia, item }); return true; },
    ...over,
  };
}

const FAMILIA = (over: Partial<FamiliaSemFilho> = {}): FamiliaSemFilho => ({
  id: 'fam-1', userId: 'user-1', codigoPai: '00012345', orgId: 'org-1', mlItemId: 'MLB1', ...over,
});

const ITEM = (over: Partial<ItemBackfillPorta> = {}): ItemBackfillPorta => ({
  status: 'active', familyId: 'FAM1', familyName: 'Cor', userProductId: 'UP1',
  permalink: 'https://ml/MLB1', sku: '00123', temVariacoes: false, sellerId: SELLER, ...over,
});

describe('reconciliarBackfill — importa itens planos pré-existentes pro modelo UP (só GET)', () => {
  it('família sem filho, item plano válido (family_name+family_id+user_product_id+sku+seller confere) → importa', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM(),
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 1, ignorados: 0 });
    expect(portas.upserts).toHaveLength(1);
    expect(portas.upserts[0].familia.id).toBe('fam-1');
    expect(portas.upserts[0].item).toEqual({
      sku: '00123', status: 'ativo', familyId: 'FAM1', userProductId: 'UP1', permalink: 'https://ml/MLB1',
    });
  });

  it('nenhuma família sem filho → inseridos=0 (2ª execução idempotente)', async () => {
    const portas = fakePortas({ listarFamiliasSemFilho: async () => [] });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 0, ignorados: 0 });
    expect(portas.upserts).toEqual([]);
  });

  it('item Legacy (temVariacoes=true) → ignora, não importa', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM({ temVariacoes: true }),
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 0, ignorados: 1 });
    expect(portas.upserts).toEqual([]);
  });

  it('item sem family_name → ignora', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM({ familyName: null }),
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 0, ignorados: 1 });
  });

  it('item sem sku (seller_custom_field) → ignora (sem SKU não dá pra ancorar (anuncio_externo_id, sku))', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM({ sku: null }),
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 0, ignorados: 1 });
  });

  it('item sem family_id ou sem user_product_id → ignora (family_name sozinho não prova UP, revisão Codex)', async () => {
    const p1 = fakePortas({ listarFamiliasSemFilho: async () => [FAMILIA()], buscarItem: async () => ITEM({ familyId: null }) });
    expect(await reconciliarBackfill(p1, SELLER)).toEqual({ inseridos: 0, ignorados: 1 });

    const p2 = fakePortas({ listarFamiliasSemFilho: async () => [FAMILIA()], buscarItem: async () => ITEM({ userProductId: null }) });
    expect(await reconciliarBackfill(p2, SELLER)).toEqual({ inseridos: 0, ignorados: 1 });
  });

  it('seller do item DIVERGE do esperado → ignora (fail-closed, revisão Codex: GET é público, não prova posse)', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM({ sellerId: 'outro-seller' }),
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 0, ignorados: 1 });
    expect(portas.upserts).toEqual([]);
  });

  it('item sem seller_id no corpo → ignora (fail-closed, nunca assume ok por ausência de divergência explícita)', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM({ sellerId: null }),
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 0, ignorados: 1 });
  });

  it('status remoto desconhecido (closed, under_review, null) → NUNCA vira "ativo" por default — ignora', async () => {
    for (const status of ['closed', 'under_review', null, 'algo_novo_do_ml']) {
      const portas = fakePortas({
        listarFamiliasSemFilho: async () => [FAMILIA()],
        buscarItem: async () => ITEM({ status }),
      });
      const r = await reconciliarBackfill(portas, SELLER);
      expect(r).toEqual({ inseridos: 0, ignorados: 1 });
    }
  });

  it('status="paused" → normaliza pra "pausado" (não "ativo")', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM({ status: 'paused' }),
    });
    await reconciliarBackfill(portas, SELLER);
    expect((portas.upserts[0].item as { status: string }).status).toBe('pausado');
  });

  it('GET falha (item null) → ignora essa família nesta rodada, segue as outras', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA({ id: 'fam-1' }), FAMILIA({ id: 'fam-2', mlItemId: 'MLB2' })],
      buscarItem: async (itemId) => (itemId === 'MLB1' ? null : ITEM()),
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 1, ignorados: 1 });
    expect(portas.upserts).toHaveLength(1);
  });

  it('múltiplas famílias, mistura de importáveis e ignoradas', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [
        FAMILIA({ id: 'fam-1', mlItemId: 'MLB1' }),
        FAMILIA({ id: 'fam-2', mlItemId: 'MLB2' }),
        FAMILIA({ id: 'fam-3', mlItemId: 'MLB3' }),
      ],
      buscarItem: async (itemId) => {
        if (itemId === 'MLB1') return ITEM();
        if (itemId === 'MLB2') return ITEM({ temVariacoes: true }); // Legacy
        return null; // GET falhou
      },
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 1, ignorados: 2 });
  });

  it('erro em upsertRaizEFilho de uma família NÃO derruba as demais (best-effort, "segue")', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [
        FAMILIA({ id: 'fam-1', mlItemId: 'MLB1' }),
        FAMILIA({ id: 'fam-2', mlItemId: 'MLB2' }),
      ],
      buscarItem: async () => ITEM(),
      upsertRaizEFilho: async (familia) => { if (familia.id === 'fam-1') throw new Error('constraint'); return true; },
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 1, ignorados: 1 });
  });

  it('upsertRaizEFilho retorna false (corrida entre 2 execuções concorrentes, ou já existia) → conta como ignorado, não inserido', async () => {
    const portas = fakePortas({
      listarFamiliasSemFilho: async () => [FAMILIA()],
      buscarItem: async () => ITEM(),
      upsertRaizEFilho: async () => false,
    });
    const r = await reconciliarBackfill(portas, SELLER);
    expect(r).toEqual({ inseridos: 0, ignorados: 1 });
  });
});
