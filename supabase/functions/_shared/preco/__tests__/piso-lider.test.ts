import { describe, it, expect } from 'vitest';
import { pisoLiderDeOfertas } from '../piso-lider';

describe('pisoLiderDeOfertas', () => {
  it('menor preço entre líderes (30 e 28), ignora não-líder mais barato (22)', () => {
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 2, preco: 28 },
      { seller_id: 3, preco: 22 },
    ];
    const ehLider = (id: number) => id === 1 || id === 2;
    expect(pisoLiderDeOfertas(ofertas, ehLider)).toBe(28);
  });

  it('nenhum líder → null', () => {
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 2, preco: 28 },
    ];
    expect(pisoLiderDeOfertas(ofertas, () => false)).toBeNull();
  });

  it('líder com preco null é ignorado', () => {
    const ofertas = [
      { seller_id: 1, preco: null },
      { seller_id: 2, preco: 40 },
    ];
    expect(pisoLiderDeOfertas(ofertas, () => true)).toBe(40);
  });

  it('todos líderes com preco null → null', () => {
    const ofertas = [
      { seller_id: 1, preco: null },
      { seller_id: 2, preco: null },
    ];
    expect(pisoLiderDeOfertas(ofertas, () => true)).toBeNull();
  });

  it('mesmo seller-líder em 2 ofertas (cores) → menor entre elas', () => {
    const ofertas = [
      { seller_id: 5, preco: 30 },
      { seller_id: 5, preco: 26 },
    ];
    expect(pisoLiderDeOfertas(ofertas, () => true)).toBe(26);
  });

  it('oferta com seller_id null é ignorada mesmo que ehLider fosse chamado', () => {
    const ofertas = [
      { seller_id: null, preco: 10 },
      { seller_id: 2, preco: 28 },
    ];
    expect(pisoLiderDeOfertas(ofertas, () => true)).toBe(28);
  });
});
