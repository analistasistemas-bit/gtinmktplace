// Identificação da busca só pelo banco (ADR-0189 emenda 02/11, Task 2): anúncio próprio e vínculo são
// estados independentes. O cliente é service-role → o filtro de org de cada consulta é o isolamento.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { identificarBusca, MAX_LINHAS_FONTE } from '../busca-local.ts';
import type { DepsCasamento } from '../busca.ts';
import type { VariacaoCusto } from '../vinculo.ts';

type Linha = Record<string, unknown>;
type Consulta = { tabela: string; select: string; eqs: [string, unknown][]; ins: [string, unknown[]][]; limit?: number };

/** Banco falso que APLICA os filtros eq/in: linha de outra org só some se a consulta filtrar a org. */
function banco(tabelas: Record<string, Linha[]>, falhas: Set<string> = new Set()) {
  const consultas: Consulta[] = [];
  const client = {
    from: (tabela: string) => {
      const c: Consulta = { tabela, select: '', eqs: [], ins: [] };
      consultas.push(c);
      const q = {
        select: (s: string) => { c.select = s; return q; },
        eq: (col: string, v: unknown) => { c.eqs.push([col, v]); return q; },
        in: (col: string, vs: unknown[]) => { c.ins.push([col, vs]); return q; },
        limit: (n: number) => { c.limit = n; return q; },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          const col = c.ins[0]?.[0] ?? '';
          if (falhas.has(`${tabela}.${col}`)) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, ko);
          const data = (tabelas[tabela] ?? [])
            .filter((l) => c.eqs.every(([k, v]) => l[k] === v) && c.ins.every(([k, vs]) => vs.includes(l[k])))
            .slice(0, c.limit ?? Infinity);
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, consultas };
}

const v = (codigo: string): VariacaoCusto => ({ variacaoId: codigo, codigo, custo: 10, origem: 'nacional', unidades: 1, codigoPai: null, dimensoes: null });
const semVinculo = (): DepsCasamento => ({
  porCatalogos: vi.fn(async () => new Map()),
  porGtin: vi.fn(async () => []),
  vinculosManuais: vi.fn(async () => new Map()),
});
const ORG = 'org-1';
const card = (itemId: string, catalogProductId: string | null = null) => ({ itemId, catalogProductId });

const FONTES = [
  'familias.ml_item_id', 'anuncios_externos.item_externo_id', 'anuncios_externos_itens.item_externo_id', 'kits_virtuais.ml_item_id',
  'variacoes.catalog_listing_id', 'anuncios_externos_itens.catalog_listing_id', 'anuncios_externos.ml_item_id_anterior',
];

describe('identificarBusca — anúncio próprio × vínculo de produto', () => {
  it('SKU vinculado sem anúncio próprio: vinculo preenchido, proprio false', async () => {
    const { client } = banco({});
    const deps = { ...semVinculo(), porCatalogos: vi.fn(async () => new Map([['MLB100', [v('001')]]])) };
    const r = await identificarBusca(client, ORG, { eanDaBusca: null, itens: [card('MLB1', 'MLB100')] }, deps);
    expect(r).toEqual({ itens: [{ itemId: 'MLB1', proprio: false, vinculo: { fonte: 'catalogo', codigo: '001' } }] });
  });

  it.each(FONTES)('anúncio próprio sem SKU vinculado, pela fonte %s', async (fonte) => {
    const [tabela, col] = fonte.split('.');
    const linha: Linha = { org_id: ORG, [col]: 'MLB2', ...(tabela === 'variacoes' ? { 'familias.org_id': ORG } : {}) };
    const { client } = banco({ [tabela]: [linha] });
    const r = await identificarBusca(client, ORG, { eanDaBusca: null, itens: [card('MLB2'), card('MLB3')] }, semVinculo());
    expect(r.itens).toEqual([
      { itemId: 'MLB2', proprio: true, vinculo: null },
      { itemId: 'MLB3', proprio: false, vinculo: null },
    ]);
  });

  it('item de outra org nunca é próprio (em nenhuma das 7 fontes)', async () => {
    const outra = 'org-2';
    const { client } = banco({
      familias: [{ org_id: outra, ml_item_id: 'MLB9' }],
      anuncios_externos: [{ org_id: outra, item_externo_id: 'MLB9', ml_item_id_anterior: 'MLB9' }],
      anuncios_externos_itens: [{ org_id: outra, item_externo_id: 'MLB9', catalog_listing_id: 'MLB9' }],
      kits_virtuais: [{ org_id: outra, ml_item_id: 'MLB9' }],
      // legado: mesmo com variacoes.org_id "certo", a família de outra org não vale (e vice-versa)
      variacoes: [{ org_id: ORG, 'familias.org_id': outra, catalog_listing_id: 'MLB9' }, { org_id: outra, 'familias.org_id': ORG, catalog_listing_id: 'MLB9' }],
    });
    const r = await identificarBusca(client, ORG, { eanDaBusca: null, itens: [card('MLB9')] }, semVinculo());
    expect(r.itens).toEqual([{ itemId: 'MLB9', proprio: false, vinculo: null }]);
  });

  it('toda consulta leva org_id explícito (legado também familias.org_id) e só os IDs pedidos, com teto de linhas', async () => {
    const { client, consultas } = banco({});
    await identificarBusca(client, ORG, { eanDaBusca: null, itens: [card('MLB1'), card('MLB2')] }, semVinculo());
    expect(consultas.map((c) => `${c.tabela}.${c.ins[0]?.[0]}`).sort()).toEqual([...FONTES].sort());
    for (const c of consultas) {
      expect(c.eqs).toContainEqual(['org_id', ORG]);
      expect(c.ins).toEqual([[expect.any(String), ['MLB1', 'MLB2']]]);
      expect(c.limit).toBe(MAX_LINHAS_FONTE);
    }
    const legado = consultas.find((c) => c.tabela === 'variacoes')!;
    expect(legado.eqs).toContainEqual(['familias.org_id', ORG]);
    expect(legado.select).toContain('familias!inner(org_id)');
  });

  it('fonte com erro: o que não foi achado vira null (indisponível), nunca false; achado em outra fonte segue true', async () => {
    const { client } = banco({ kits_virtuais: [{ org_id: ORG, ml_item_id: 'MLB2' }] }, new Set(['familias.ml_item_id']));
    const r = await identificarBusca(client, ORG, { eanDaBusca: null, itens: [card('MLB1'), card('MLB2')] }, semVinculo());
    expect(r.itens).toEqual([
      { itemId: 'MLB1', proprio: null, vinculo: null },
      { itemId: 'MLB2', proprio: true, vinculo: null },
    ]);
  });

  it('fonte que bate o teto de linhas é tratada como incompleta (null), não como "não é próprio"', async () => {
    const linhas = Array.from({ length: MAX_LINHAS_FONTE }, () => ({ org_id: ORG, ml_item_id: 'MLB2' }));
    const { client } = banco({ familias: linhas });
    const r = await identificarBusca(client, ORG, { eanDaBusca: null, itens: [card('MLB1'), card('MLB2')] }, semVinculo());
    expect(r.itens).toEqual([
      { itemId: 'MLB1', proprio: null, vinculo: null },
      { itemId: 'MLB2', proprio: true, vinculo: null },
    ]);
  });

  it('vínculo usa casarCards (EAN da busca e vínculo manual) com a org do pedido', async () => {
    const { client } = banco({});
    const deps = { ...semVinculo(), vinculosManuais: vi.fn(async () => new Map([['item:MLB5', v('777')]])) };
    const r = await identificarBusca(client, ORG, { eanDaBusca: null, itens: [card('MLB5')] }, deps);
    expect(r.itens[0].vinculo).toEqual({ fonte: 'vinculo_manual', codigo: '777' });
    expect(deps.vinculosManuais).toHaveBeenCalledWith(ORG, [{ tipo: 'item', valor: 'MLB5' }]);
  });
});
