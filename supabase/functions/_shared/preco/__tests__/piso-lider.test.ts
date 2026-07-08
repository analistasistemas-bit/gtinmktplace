import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pisoLiderDeOfertas, calcularPisoLider } from '../piso-lider';
import { reputacaoVendedor } from '../../ml/mercado.ts';

vi.mock('../../ml/mercado.ts', () => ({
  reputacaoVendedor: vi.fn(),
}));

const reputacaoVendedorMock = vi.mocked(reputacaoVendedor);

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

describe('calcularPisoLider', () => {
  beforeEach(() => {
    reputacaoVendedorMock.mockReset();
  });

  it('seller líder (30) vence não-líder mais barato (22)', async () => {
    reputacaoVendedorMock.mockImplementation((_token, sellerId) =>
      Promise.resolve(sellerId === 1 ? { lider: true, vendas: 100 } : { lider: false, vendas: 5 }),
    );
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 2, preco: 22 },
    ];
    expect(await calcularPisoLider('token', ofertas)).toBe(30);
  });

  it('dedup: mesmo seller_id em várias ofertas → reputacaoVendedor chamada 1x por seller distinto', async () => {
    reputacaoVendedorMock.mockResolvedValue({ lider: true, vendas: 10 });
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 1, preco: 26 },
      { seller_id: 2, preco: 20 },
    ];
    await calcularPisoLider('token', ofertas);
    expect(reputacaoVendedorMock).toHaveBeenCalledTimes(2);
  });

  it('reputação de um seller falha → tratado como não-líder, não quebra', async () => {
    reputacaoVendedorMock.mockImplementation((_token, sellerId) =>
      sellerId === 1
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve({ lider: true, vendas: 10 }),
    );
    const ofertas = [
      { seller_id: 1, preco: 15 },
      { seller_id: 2, preco: 25 },
    ];
    expect(await calcularPisoLider('token', ofertas)).toBe(25);
  });
});
