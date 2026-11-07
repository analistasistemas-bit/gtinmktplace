import { describe, expect, it, vi } from 'vitest';
import { aplicarAtacadoPorItem } from '../atacado-por-item.ts';

const CTX = {} as never;
const conn = (aplicarAtacado = vi.fn(async () => {})) => ({ aplicarAtacado }) as never as { aplicarAtacado: ReturnType<typeof vi.fn> };
const CINCO = [{ min_unidades: 2, desconto_pct: 5 }];

describe('aplicarAtacadoPorItem', () => {
  it('cada item recebe as faixas sobre o próprio preço', async () => {
    const c = conn();
    expect(await aplicarAtacadoPorItem(c as never, CTX, [{ id: 'A', preco: 10 }, { id: 'B', preco: 25 }], CINCO)).toBeNull();
    expect(c.aplicarAtacado.mock.calls).toEqual([[CTX, 'A', 10, CINCO], [CTX, 'B', 25, CINCO]]);
  });

  // Arredondamento real do payload: R$ 1,00 com 0,1% vira R$ 1,00, faixa igual ao base.
  it('valor enviado igual ao base: não envia a nenhum item e explica', async () => {
    const c = conn();
    const faixas = [{ min_unidades: 2, desconto_pct: 0.1 }];
    const erro = await aplicarAtacadoPorItem(c as never, CTX, [{ id: 'A', preco: 50 }, { id: 'B', preco: 1 }], faixas);
    expect(erro).toMatch(/B.*igual ou acima/);
    expect(c.aplicarAtacado).not.toHaveBeenCalled();
  });

  it('a mesma config passa no item em que o arredondamento não encosta no base', async () => {
    expect(await aplicarAtacadoPorItem(conn() as never, CTX, [{ id: 'A', preco: 50 }], [{ min_unidades: 2, desconto_pct: 0.1 }])).toBeNull();
  });

  it('item sem preço: não envia a nenhum', async () => {
    const c = conn();
    expect(await aplicarAtacadoPorItem(c as never, CTX, [{ id: 'A', preco: 10 }, { id: 'B', preco: null }], CINCO)).toMatch(/preço-base/);
    expect(c.aplicarAtacado).not.toHaveBeenCalled();
  });

  it('desconto ilegível vira erro, não exceção', async () => {
    expect(await aplicarAtacadoPorItem(conn() as never, CTX, [{ id: 'A', preco: 10 }], [{ min_unidades: 2, desconto_pct: NaN }])).toMatch(/igual ou acima/);
  });

  it('limpar não depende de preço', async () => {
    const c = conn();
    expect(await aplicarAtacadoPorItem(c as never, CTX, [{ id: 'A', preco: null }], [])).toBeNull();
    expect(c.aplicarAtacado.mock.calls).toEqual([[CTX, 'A', 0, []]]);
  });

  it('falha em um item segue para os outros e devolve erro', async () => {
    const c = conn(vi.fn(async (_c: unknown, id: string) => { if (id === 'A') throw new Error('ML 500'); }));
    expect(await aplicarAtacadoPorItem(c as never, CTX, [{ id: 'A', preco: 10 }, { id: 'B', preco: 25 }], CINCO)).toBe('Falha ao aplicar atacado em uma ou mais cores');
    expect(c.aplicarAtacado).toHaveBeenCalledTimes(2);
  });
});
