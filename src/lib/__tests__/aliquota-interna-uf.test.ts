import { describe, it, expect } from 'vitest';
import { montarAliquotaResolver, montarMapasCusto } from '../custos';
import type { VendaItem } from '../faturamento';

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'MLB1', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, ...over,
});

// Catálogo: MLB1 é nacional, MLB2 é importado.
const mapas = montarMapasCusto([
  { custo: 10, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: null,
    atualizado_em: '2026-08-01T00:00:00Z', familias: { ml_item_id: 'MLB1', origem: 'nacional' } },
  { custo: 10, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: null,
    atualizado_em: '2026-08-01T00:00:00Z', familias: { ml_item_id: 'MLB2', origem: 'importado' } },
]);

const comInterna = { nacional: 8, importado: 16, ufEmpresa: 'PE', internaPct: 1 };
const semInterna = { nacional: 8, importado: 16, ufEmpresa: null, internaPct: null };

describe('montarAliquotaResolver — alíquota interna por UF (ADR-0112)', () => {
  it('usa a alíquota interna quando o pedido é entregue na UF da empresa', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({}), 'PE')).toBe(1);
  });

  it('sobrepõe também a origem importado', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({ ml_item_id: 'MLB2' }), 'PE')).toBe(1);
  });

  it('compara a UF sem diferenciar maiúsculas de minúsculas', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({}), 'pe')).toBe(1);
  });

  it('mantém a alíquota por origem em pedido de outra UF', () => {
    const r = montarAliquotaResolver(mapas, comInterna);
    expect(r(item({}), 'SP')).toBe(8);
    expect(r(item({ ml_item_id: 'MLB2' }), 'SP')).toBe(16);
  });

  it('mantém a alíquota por origem quando o pedido não tem UF', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({}), null)).toBe(8);
  });

  it('mantém a alíquota por origem quando o parâmetro não está configurado', () => {
    expect(montarAliquotaResolver(mapas, semInterna)(item({}), 'PE')).toBe(8);
  });

  // A alíquota interna é decidida ANTES da origem, então só sobra null quando não há interna
  // aplicável E a origem não foi resolvida — daí a UF 'SP' aqui.
  it('não inventa alíquota para item sem origem no catálogo', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({ ml_item_id: 'MLB9' }), 'SP')).toBeNull();
  });

  it('não aplica imposto quando a configuração ainda não carregou', () => {
    expect(montarAliquotaResolver(mapas, null)(item({}), 'PE')).toBeNull();
  });
});
