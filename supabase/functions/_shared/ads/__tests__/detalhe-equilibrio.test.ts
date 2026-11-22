import { describe, expect, it } from 'vitest';
import { detalheEquilibrioDoMlb, equilibrioDoMlb, parseItensBulk } from '../campanhas.ts';
import { montarCadastro, type LinhaVariacao } from '../../promocoes/cadastro.ts';
import type { ItemML, Tarifa } from '../../promocoes/tipos.ts';

const v = (o: Partial<LinhaVariacao> & { id: string }): LinhaVariacao => ({
  custo: 10, preco: 18, cor: 'Azul', codigo: null, gtin: null, ml_variation_id: null,
  peso_gramas: 200, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: 'MLB1', origem: 'nacional' }, ...o,
});
const duas: ItemML = {
  id: 'MLB1', titulo: null, thumbnail: null, permalink: null, listing_type_id: 'gold_special', categoria: 'MLB1234',
  sku: null, gtin: null, unidades: null, formato_kit: false, catalogo: false, relacionados: [],
  variacoes: [{ variation_id: 1, cor: 'A', sku: 'SKU-A', gtin: null }, { variation_id: 2, cor: 'B', sku: 'SKU-B', gtin: null }],
};
const TARIFA: Tarifa = { comissao: { percentual: 12, fixa: 6 }, frete: 0 };
const ALIQ = { nacional: 8, importado: 16 };

describe('detalheEquilibrioDoMlb', () => {
  const cad = montarCadastro([
    v({ id: 'a', ml_variation_id: '1', custo: 10 }),
    v({ id: 'b', ml_variation_id: '2', custo: 14 }),
  ], []);

  it('pior cor com a decomposição do preço', async () => {
    const r = await detalheEquilibrioDoMlb(duas, 50, cad, ALIQ, async () => TARIFA);
    expect(r.motivo).toBeNull();
    expect(r.acosPct).toBe(40);
    const p = r.pior!;
    expect(p).toEqual({ variacao_id: 'b', sku: 'SKU-B', custo: 14, comissao: 12, frete: 0, imposto: 4, liquido: 34, margemPct: 40 });
    expect(p.comissao + p.frete + p.imposto + p.liquido).toBe(50);
  });

  it('paridade com equilibrioDoMlb', async () => {
    const d = await detalheEquilibrioDoMlb(duas, 50, cad, ALIQ, async () => TARIFA);
    expect(await equilibrioDoMlb(duas, 50, cad, ALIQ, async () => TARIFA)).toEqual({ acosPct: d.acosPct, motivo: d.motivo });
  });

  it('empate de margem → primeira cor', async () => {
    const igual = montarCadastro([v({ id: 'a', ml_variation_id: '1' }), v({ id: 'b', ml_variation_id: '2' })], []);
    expect((await detalheEquilibrioDoMlb(duas, 50, igual, ALIQ, async () => TARIFA)).pior?.variacao_id).toBe('a');
  });

  it('com motivo, pior é null', async () => {
    expect(await detalheEquilibrioDoMlb(duas, null, cad, ALIQ, async () => TARIFA))
      .toEqual({ acosPct: null, motivo: 'sem_preco', pior: null });
  });
});

describe('parseItensBulk: preço de tabela', () => {
  it('original_price vira precoTabela; ausência → null', () => {
    const m = parseItensBulk([
      { status_code: 200, body: { id: 'MLB1', status: 'active', price: 50, original_price: 60 } },
      { status_code: 200, body: { id: 'MLB2', status: 'active', price: 50 } },
    ], ['MLB1', 'MLB2']);
    expect(m.get('MLB1')?.precoTabela).toBe(60);
    expect(m.get('MLB2')?.precoTabela).toBeNull();
  });
});
