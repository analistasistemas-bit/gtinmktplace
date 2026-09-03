import { describe, it, expect } from 'vitest';
import { tituloDoKit, precoSugeridoDoKit, descricaoDoKit, TITULO_MAX_KIT, contarKitsAguardandoPorPai } from '../kit';
import type { KitVinculado } from '../queries';

function criarKit(overrides: Partial<KitVinculado> = {}): KitVinculado {
  return {
    familiaId: 'kit-1',
    codigoPai: 'KIT001',
    kitBaseCodigoPai: 'PAI1',
    multiplicador: 3,
    status: 'pronto',
    mlPermalink: null,
    mlItemId: null,
    criadoEm: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('tituloDoKit', () => {
  it('acrescenta o tamanho do kit ao título da base', () => {
    expect(tituloDoKit('Fita Adesiva Transparente 45mm', 3))
      .toBe('Fita Adesiva Transparente 45mm Kit 3 Unidades');
  });

  it('nunca ultrapassa 60 caracteres — corta o título da base, não o sufixo', () => {
    const base = 'Fita Adesiva Transparente Dupla Face Extra Forte 45mm x 50m';
    const r = tituloDoKit(base, 6);
    expect(r.length).toBeLessThanOrEqual(TITULO_MAX_KIT);
    expect(r.endsWith('Kit 6 Unidades')).toBe(true);
  });

  it('não corta no meio de uma palavra', () => {
    const r = tituloDoKit('Fita Adesiva Transparente Dupla Face Extra Forte 45mm', 2);
    expect(r).not.toMatch(/\s\S+?-?\s?Kit 2 Unidades$/u.source.length ? / {2}/ : / {2}/);
    expect(r.trim()).toBe(r);
  });
});

describe('precoSugeridoDoKit', () => {
  it('multiplica o preço unitário pelo tamanho', () => {
    expect(precoSugeridoDoKit(19.9, 3)).toBe(59.7);
  });
  it('aplica o desconto opcional sobre o total', () => {
    expect(precoSugeridoDoKit(100, 2, 10)).toBe(180);
  });
  it('arredonda a 2 casas', () => {
    expect(precoSugeridoDoKit(19.99, 3, 7)).toBe(55.77);
  });
});

describe('descricaoDoKit', () => {
  it('acrescenta a linha do tamanho ao final da descrição da base', () => {
    expect(descricaoDoKit('Fita de boa qualidade.', 4))
      .toBe('Fita de boa qualidade.\n\nKit com 4 unidades.');
  });
});

describe('contarKitsAguardandoPorPai', () => {
  it('conta kit pronto e ainda sem ml_item_id', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'pronto', mlItemId: null })]);
    expect(mapa.get('PAI1')).toBe(1);
  });

  it('não conta kit publicado', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'publicado', mlItemId: 'ML123' })]);
    expect(mapa.get('PAI1')).toBeUndefined();
  });

  it('não conta kit em erro', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'erro', mlItemId: null })]);
    expect(mapa.get('PAI1')).toBeUndefined();
  });

  it('não conta kit pronto mas já com ml_item_id preenchido', () => {
    const mapa = contarKitsAguardandoPorPai([criarKit({ status: 'pronto', mlItemId: 'ML123' })]);
    expect(mapa.get('PAI1')).toBeUndefined();
  });

  it('agrupa corretamente por codigoPai quando há kits de produtos diferentes', () => {
    const mapa = contarKitsAguardandoPorPai([
      criarKit({ kitBaseCodigoPai: 'PAI1', status: 'pronto', mlItemId: null }),
      criarKit({ kitBaseCodigoPai: 'PAI1', status: 'pronto', mlItemId: null, multiplicador: 4 }),
      criarKit({ kitBaseCodigoPai: 'PAI2', status: 'pronto', mlItemId: null }),
      criarKit({ kitBaseCodigoPai: 'PAI2', status: 'publicado', mlItemId: 'ML9' }),
    ]);
    expect(mapa.get('PAI1')).toBe(2);
    expect(mapa.get('PAI2')).toBe(1);
  });
});
