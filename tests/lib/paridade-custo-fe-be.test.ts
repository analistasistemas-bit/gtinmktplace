import { describe, it, expect } from 'vitest';
import { montarMapasCusto, montarCustoResolver } from '@/lib/custos';
import { montarMapasCustoVigente, resolverCustoVigente } from '../../supabase/functions/_shared/faturamento/custo-vigente';
import type { VendaItem } from '@/lib/faturamento';

// A resolução do custo está duplicada entre FE (markup exibido) e BE (valor CONGELADO na venda,
// ADR-0109). Divergir significa a tela mostrar um número e o banco gravar outro, para sempre —
// congelado não se corrige. Este teste falha assim que as cópias se afastarem. Ver ADR-0108/0109.

/** Fixture lógica, traduzida para o formato de cada lado. */
interface Linha {
  custo: unknown; atualizado_em?: unknown;
  variacao?: string; item?: string; gtin?: string; codigo?: string;
}

const paraFE = (l: Linha): Record<string, unknown> => ({
  custo: l.custo, peso_gramas: 100, atualizado_em: l.atualizado_em ?? null,
  ml_variation_id: l.variacao ?? null, gtin: l.gtin ?? null, codigo: l.codigo ?? null,
  familias: { ml_item_id: l.item ?? null, origem: null },
});

const paraBE = (l: Linha) => ({
  custo: l.custo, atualizado_em: l.atualizado_em ?? null,
  ml_variation_id: l.variacao ?? null, ml_item_id: l.item ?? null,
  gtin: l.gtin ?? null, codigo: l.codigo ?? null,
});

const item = (o: Partial<VendaItem>): VendaItem => ({
  id: 'it', ml_item_id: null, variation_id: null, titulo: null, codigo: null,
  cor: null, ean: null, quantity: 1, unit_price: 0, sale_fee: 0, is_publiai: true, ...o,
});

/** Catálogo com todos os formatos que aparecem em produção. */
const LINHAS: Linha[] = [
  { variacao: '12345', custo: 100, atualizado_em: '2026-07-01T00:00:00Z' },
  { item: 'MLB1', custo: 200, atualizado_em: '2026-07-01T00:00:00Z' },
  { gtin: '0007891', custo: 300, atualizado_em: '2026-07-01T00:00:00Z' },
  { codigo: '00099', custo: 400, atualizado_em: '2026-07-01T00:00:00Z' },
  // Caso COLA (ADR-0108): mesmas chaves, custo caiu, vence a linha mais recente.
  { variacao: '203734189745', item: 'MLB6943015034', gtin: '7453000325513', codigo: '02841037', custo: 17.1224, atualizado_em: '2026-07-05T18:08:06Z' },
  { variacao: '203734189745', item: 'MLB6943015034', gtin: '7453000325513', codigo: '02841037', custo: 15.8558, atualizado_em: '2026-08-07T17:33:17Z' },
  // Bordas do tie-break e dos descartes.
  { variacao: 'semdata', custo: 33, atualizado_em: '2026-08-01T00:00:00Z' },
  { variacao: 'semdata', custo: 44, atualizado_em: null },
  { variacao: 'datalixo', custo: 55, atualizado_em: '2026-08-01T00:00:00Z' },
  { variacao: 'datalixo', custo: 66, atualizado_em: 'lixo' },
  { variacao: 'zero', custo: 0 },
  { variacao: 'negativo', custo: -5 },
  { variacao: 'nulo', custo: null },
  { variacao: 'naonumerico', custo: 'abc' },
  { variacao: 'string', custo: '12.34', atualizado_em: '2026-07-01T00:00:00Z' },
];

const ITENS: VendaItem[] = [
  item({ variation_id: 12345, ml_item_id: 'MLB1', ean: '7891', codigo: '00099' }), // precedência
  item({ variation_id: 999, ml_item_id: 'MLB1' }),
  item({ ml_item_id: 'ZZZ', ean: '7891' }),
  item({ ean: '000', codigo: '00099' }),
  item({ ean: '0007891' }),      // zeros à esquerda dos dois lados
  item({ codigo: '2841037' }),   // idem, no código
  item({ variation_id: 203734189745 }),
  item({ ml_item_id: 'MLB6943015034' }),
  item({ ean: '7453000325513' }),
  item({ codigo: '02841037' }),
  item({ variation_id: 'semdata' as unknown as number }),
  item({ variation_id: 'datalixo' as unknown as number }),
  item({ variation_id: 'zero' as unknown as number }),
  item({ variation_id: 'negativo' as unknown as number }),
  item({ variation_id: 'nulo' as unknown as number }),
  item({ variation_id: 'naonumerico' as unknown as number }),
  item({ variation_id: 'string' as unknown as number }),
  item({ variation_id: 1, ml_item_id: 'X', ean: '2', codigo: '3' }), // nada casa
];

describe('paridade FE ↔ BE na resolução do custo (ADR-0109)', () => {
  const fe = montarCustoResolver(montarMapasCusto(LINHAS.map(paraFE)));
  const be = montarMapasCustoVigente(LINHAS.map(paraBE));

  it.each(ITENS.map((i, n) => [n, i] as const))('item %i resolve igual dos dois lados', (_n, it_) => {
    expect(resolverCustoVigente(be, {
      variation_id: it_.variation_id, ml_item_id: it_.ml_item_id, ean: it_.ean, codigo: it_.codigo,
    })).toEqual(fe(it_));
  });

  it('o caso COLA resolve 15.8558 nos dois (não o custo antigo maior)', () => {
    const cola = item({ codigo: '02841037' });
    expect(fe(cola)).toBe(15.8558);
    expect(resolverCustoVigente(be, { variation_id: null, ml_item_id: null, ean: null, codigo: '02841037' })).toBe(15.8558);
  });
});
