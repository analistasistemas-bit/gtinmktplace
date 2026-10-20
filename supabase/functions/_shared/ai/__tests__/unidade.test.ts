import { describe, it, expect } from 'vitest';
import { corrigirRotuloQuantidade, rotuloQuantidade } from '../unidade';

describe('rotuloQuantidade', () => {
  it('unidade de peso (KG) → "Peso"', () => {
    expect(rotuloQuantidade('KG')).toBe('Peso');
  });

  it('normaliza caixa e espaços (" kg " → "Peso")', () => {
    expect(rotuloQuantidade(' kg ')).toBe('Peso');
  });

  it('gramas (G / GRAMAS) → "Peso"', () => {
    expect(rotuloQuantidade('G')).toBe('Peso');
    expect(rotuloQuantidade('GRAMAS')).toBe('Peso');
  });

  it('volume (L / ML) → "Volume"', () => {
    expect(rotuloQuantidade('L')).toBe('Volume');
    expect(rotuloQuantidade('ML')).toBe('Volume');
  });

  it('comprimento (MT / METROS) → "Metragem"', () => {
    expect(rotuloQuantidade('MT')).toBe('Metragem');
    expect(rotuloQuantidade('METROS')).toBe('Metragem');
  });

  it('unidades de embalagem (PC/RL/UN/CN) → null (IA decide pelo dado da descrição)', () => {
    expect(rotuloQuantidade('PC')).toBeNull();
    expect(rotuloQuantidade('RL')).toBeNull();
    expect(rotuloQuantidade('UN')).toBeNull();
    expect(rotuloQuantidade('CN')).toBeNull();
  });

  it('vazio/nulo/desconhecido → null', () => {
    expect(rotuloQuantidade(null)).toBeNull();
    expect(rotuloQuantidade('')).toBeNull();
    expect(rotuloQuantidade('XYZ')).toBeNull();
  });
});

describe('corrigirRotuloQuantidade', () => {
  const f = corrigirRotuloQuantidade;

  it('volume → Volume', () => {
    expect(f('• Metragem: 120ml')).toBe('• Volume: 120ml');
    expect(f('• Metragem: 1,5 L')).toBe('• Volume: 1,5 L');
    expect(f('- Metragem: 2 litros')).toBe('- Volume: 2 litros');
  });

  it('massa → Peso', () => {
    expect(f('• Metragem: 500 g')).toBe('• Peso: 500 g');
    expect(f('• metragem: 1kg')).toBe('• Peso: 1kg');
  });

  it.each(['ml', 'l', 'lt', 'litro', 'litros'])('alias de volume %s', (u) => {
    expect(f(`• Metragem: 2 ${u}`)).toBe(`• Volume: 2 ${u}`);
  });

  it.each(['g', 'gr', 'grs', 'grama', 'gramas', 'kg', 'kgs'])('alias de massa %s', (u) => {
    expect(f(`• Metragem: 2 ${u}`)).toBe(`• Peso: 2 ${u}`);
  });

  it('comprimento (fita) fica intacto', () => {
    for (const s of ['• Metragem: 50m', '• Metragem: 100 metros', '• Metragem: 1,5 m']) {
      expect(f(s)).toBe(s);
    }
  });

  it('prosa sem bullet fica intacta', () => {
    expect(f('A metragem: 120ml no frasco')).toBe('A metragem: 120ml no frasco');
  });

  it('fronteira Unicode e unidade composta ficam intactas', () => {
    expect(f('• Metragem: 500 grãos')).toBe('• Metragem: 500 grãos');
    expect(f('• Metragem: 80 g/m²')).toBe('• Metragem: 80 g/m²');
  });

  it('valor na linha seguinte fica intacto', () => {
    expect(f('• Metragem:\n120ml')).toBe('• Metragem:\n120ml');
  });

  it('multilinha muda só a linha da metragem; idempotente', () => {
    const e = '• Marca: Göttin Laboratory\n• Metragem: 120ml\n• Aplicação: limpeza facial';
    const s = '• Marca: Göttin Laboratory\n• Volume: 120ml\n• Aplicação: limpeza facial';
    expect(f(e)).toBe(s);
    expect(f(f(e))).toBe(f(e));
  });
});
