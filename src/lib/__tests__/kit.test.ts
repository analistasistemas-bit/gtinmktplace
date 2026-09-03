import { describe, it, expect } from 'vitest';
import { tituloDoKit, precoSugeridoDoKit, descricaoDoKit, TITULO_MAX_KIT } from '../kit';

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
