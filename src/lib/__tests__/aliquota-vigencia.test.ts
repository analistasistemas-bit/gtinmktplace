import { describe, it, expect } from 'vitest';
import { montarAliquotaResolver, montarMapasCusto } from '../custos';
import { impostoDoItem } from '../resumo-vendas';
import type { VendaItem } from '../faturamento';

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'MLB1', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, ...over,
});

// Catálogo: MLB1 é nacional.
const mapas = montarMapasCusto([
  { custo: 10, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: null,
    atualizado_em: '2026-08-01T00:00:00Z', familias: { ml_item_id: 'MLB1', origem: 'nacional' } },
]);

const vig = { nacional: 6.5, importado: 0, ufEmpresa: 'PE', internaPct: 6.5, vigencias: [
  { vigenteDesde: '1970-01-01T00:00:00Z', nacional: 4, importado: 0, ufEmpresa: 'PE', internaPct: 4 },
  { vigenteDesde: '2026-11-17T12:40:00Z', nacional: 6.5, importado: 0, ufEmpresa: 'PE', internaPct: 6.5 },
] };

describe('montarAliquotaResolver — vigência por data da venda (ADR-0208)', () => {
  it('venda antes da troca usa a alíquota antiga', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-16T10:00:00Z')).toBe(4));

  it('venda depois da troca usa a nova', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-17T13:00:00Z')).toBe(6.5));

  it('venda no instante exato da troca usa a nova', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-17T12:40:00Z')).toBe(6.5));

  it('interna por UF também respeita a vigência', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'PE', '2026-11-16T10:00:00Z')).toBe(4));

  it('ordem da lista não importa', () =>
    expect(montarAliquotaResolver(mapas, { ...vig, vigencias: [...vig.vigencias].reverse() })(item({}), 'SP', '2026-11-16T10:00:00Z')).toBe(4));

  it('data anterior a todas as vigências usa a mais antiga', () => {
    const v = { nacional: 9, importado: 0, ufEmpresa: null, internaPct: null, vigencias: [
      { vigenteDesde: '2026-06-01T00:00:00Z', nacional: 7, importado: 0, ufEmpresa: null, internaPct: null },
      { vigenteDesde: '2026-01-01T00:00:00Z', nacional: 5, importado: 0, ufEmpresa: null, internaPct: null },
    ] };
    expect(montarAliquotaResolver(mapas, v)(item({}), 'SP', '2025-06-15T00:00:00Z')).toBe(5);
  });

  it('sem vigências usa as alíquotas atuais', () =>
    expect(montarAliquotaResolver(mapas, { nacional: 8, importado: 16 })(item({}), 'SP', '2020-01-01T00:00:00Z')).toBe(8));

  it('lista de vigências vazia usa as alíquotas atuais', () =>
    expect(montarAliquotaResolver(mapas, { nacional: 8, importado: 16, vigencias: [] })(item({}), 'SP', '2020-01-01T00:00:00Z')).toBe(8));

  it('mesmo instante em -03:00 e em UTC dá o mesmo resultado', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-17T09:40:00-03:00')).toBe(6.5));

  it('data null usa as alíquotas atuais', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', null)).toBe(6.5));

  it('data inválida usa as alíquotas atuais', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', 'lixo')).toBe(6.5));

  it('compara instantes, não strings: 10:00-03:00 (=13:00Z) já é depois da troca 12:40Z', () =>
    // Comparação por string acharia "10:00" < "12:40" e devolveria a alíquota antiga.
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-17T10:00:00-03:00')).toBe(6.5));

  it('impostoDoItem aplica a alíquota da data', () =>
    expect(impostoDoItem(item({ unit_price: 100 }), montarAliquotaResolver(mapas, vig), 'SP', '2026-11-16T10:00:00Z')).toBe(4));
});
