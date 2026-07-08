import { describe, it, expect, vi, beforeEach } from 'vitest';
import { precoLiderMaisVendas, calcularPrecoLiderMaisVendas } from '../piso-lider';
import { reputacaoVendedor } from '../../ml/mercado.ts';

vi.mock('../../ml/mercado.ts', () => ({
  reputacaoVendedor: vi.fn(),
}));

const reputacaoVendedorMock = vi.mocked(reputacaoVendedor);

describe('precoLiderMaisVendas', () => {
  it('3 líderes com vendas diferentes → vence o de mais vendas (500), retorna o preço dele', () => {
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 2, preco: 20 },
      { seller_id: 3, preco: 25 },
    ];
    const reps: Record<number, { lider: boolean; vendas: number }> = {
      1: { lider: true, vendas: 10 },
      2: { lider: true, vendas: 500 },
      3: { lider: true, vendas: 200 },
    };
    expect(precoLiderMaisVendas(ofertas, (id) => reps[id])).toBe(20);
  });

  it('não-líder com mais vendas que os líderes é ignorado; vence o líder de mais vendas', () => {
    const ofertas = [
      { seller_id: 1, preco: 30 }, // não-líder, mais vendas de todos
      { seller_id: 2, preco: 20 },
      { seller_id: 3, preco: 25 },
    ];
    const reps: Record<number, { lider: boolean; vendas: number }> = {
      1: { lider: false, vendas: 999 },
      2: { lider: true, vendas: 500 },
      3: { lider: true, vendas: 200 },
    };
    expect(precoLiderMaisVendas(ofertas, (id) => reps[id])).toBe(20);
  });

  it('empate de vendas entre 2 líderes → desempata pelo menor preço', () => {
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 2, preco: 25 },
    ];
    const reps: Record<number, { lider: boolean; vendas: number }> = {
      1: { lider: true, vendas: 100 },
      2: { lider: true, vendas: 100 },
    };
    expect(precoLiderMaisVendas(ofertas, (id) => reps[id])).toBe(25);
  });

  it('líder de mais vendas com ofertas em 2 cores (30 e 22) → usa o menor preço DELE, não de outro líder com oferta única mais barata mas menos vendas', () => {
    const ofertas = [
      { seller_id: 1, preco: 30 }, // seller 1, cor A
      { seller_id: 1, preco: 22 }, // seller 1, cor B
      { seller_id: 2, preco: 18 }, // seller 2, menos vendas, mais barato
    ];
    const reps: Record<number, { lider: boolean; vendas: number }> = {
      1: { lider: true, vendas: 61706 },
      2: { lider: true, vendas: 13180 },
    };
    expect(precoLiderMaisVendas(ofertas, (id) => reps[id])).toBe(22);
  });

  it('nenhum líder → null', () => {
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 2, preco: 28 },
    ];
    expect(precoLiderMaisVendas(ofertas, () => undefined)).toBeNull();
  });

  it('reputacao retorna undefined p/ um seller (falha ao buscar) → tratado como não-líder, não quebra', () => {
    const ofertas = [
      { seller_id: 1, preco: 15 },
      { seller_id: 2, preco: 25 },
    ];
    const reps: Record<number, { lider: boolean; vendas: number }> = {
      2: { lider: true, vendas: 50 },
    };
    expect(precoLiderMaisVendas(ofertas, (id) => reps[id])).toBe(25);
  });
});

describe('calcularPrecoLiderMaisVendas', () => {
  beforeEach(() => {
    reputacaoVendedorMock.mockReset();
  });

  it('seller líder de mais vendas vence não-líder mais barato', async () => {
    reputacaoVendedorMock.mockImplementation((_token, sellerId) =>
      Promise.resolve(sellerId === 1 ? { lider: true, vendas: 100 } : { lider: false, vendas: 5 }),
    );
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 2, preco: 22 },
    ];
    expect(await calcularPrecoLiderMaisVendas('token', ofertas)).toBe(30);
  });

  it('dedup: mesmo seller_id em várias ofertas → reputacaoVendedor chamada 1x por seller distinto', async () => {
    reputacaoVendedorMock.mockResolvedValue({ lider: true, vendas: 10 });
    const ofertas = [
      { seller_id: 1, preco: 30 },
      { seller_id: 1, preco: 26 },
      { seller_id: 2, preco: 20 },
    ];
    await calcularPrecoLiderMaisVendas('token', ofertas);
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
    expect(await calcularPrecoLiderMaisVendas('token', ofertas)).toBe(25);
  });
});
