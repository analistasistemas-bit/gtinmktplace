import { describe, expect, it } from 'vitest';
import { lerUnitario, MAX_UNITARIO, precoComDescontoDoKit, unitariosDosKits, type DepsUnitario } from '../unitario-kit.ts';

const deps = (o: Partial<DepsUnitario> = {}): DepsUnitario => ({
  baseDoKit: async (id) => (id === 'KIT' ? { item_id: 'BASE', unidades: 2 } : null),
  precoNormal: async () => 45.9,
  projetar: async () => ({ projecao: [], pior_semaforo: 'verde' }),
  ...o,
});

describe('lerUnitario', () => {
  it('aceita pedido válido', () => {
    expect(lerUnitario({ itens: [{ ml_item_id: 'KIT', preco: 73.08, preco_original: 84 }] }))
      .toEqual({ itens: [{ ml_item_id: 'KIT', preco: 73.08, preco_original: 84 }] });
  });
  it.each([
    [{ itens: [] }],
    [{ itens: [{ ml_item_id: 'KIT', preco: 73.08 }] }],
    [{ itens: [{ ml_item_id: 'KIT', preco: 0, preco_original: 84 }] }],
    [{ itens: [{ ml_item_id: '', preco: 1, preco_original: 84 }] }],
    [{ itens: Array.from({ length: MAX_UNITARIO + 1 }, () => ({ ml_item_id: 'K', preco: 1, preco_original: 2 })) }],
  ])('recusa pedido inválido %#', (b) => expect(lerUnitario(b)).toBeNull());
});

describe('precoComDescontoDoKit', () => {
  it('aplica o mesmo % do kit ao cheio do avulso (R$ 84 → 73,08 = −13%)', () => {
    expect(precoComDescontoDoKit(45.9, 73.08, 84)).toBe(39.93);
  });
  it('kit sem desconto → avulso no cheio', () => expect(precoComDescontoDoKit(45.9, 84, 84)).toBe(45.9));
});

describe('unitariosDosKits', () => {
  it('projeta o avulso da base no preço com desconto', async () => {
    const vistos: [string, number][] = [];
    const r = await unitariosDosKits({ itens: [{ ml_item_id: 'KIT', preco: 73.08, preco_original: 84 }] },
      deps({ projetar: async (id, p) => { vistos.push([id, p]); return { projecao: [], pior_semaforo: 'amarelo' }; } }));
    expect(vistos).toEqual([['BASE', 39.93]]);
    expect(r).toEqual([{ ml_item_id: 'KIT', base_item_id: 'BASE', unidades: 2, preco_cheio: 45.9, preco: 39.93, projecao: [], pior_semaforo: 'amarelo' }]);
  });
  it('não é kit, sem preço vivo, sem alíquota ou erro → fora da resposta (nunca lança)', async () => {
    const item = { ml_item_id: 'KIT', preco: 73.08, preco_original: 84 };
    expect(await unitariosDosKits({ itens: [{ ...item, ml_item_id: 'AVULSO' }] }, deps())).toEqual([]);
    expect(await unitariosDosKits({ itens: [item] }, deps({ precoNormal: async () => null }))).toEqual([]);
    expect(await unitariosDosKits({ itens: [item] }, deps({ projetar: async () => null }))).toEqual([]);
    expect(await unitariosDosKits({ itens: [item] }, deps({ precoNormal: async () => { throw new Error('ML 500'); } }))).toEqual([]);
  });
});
