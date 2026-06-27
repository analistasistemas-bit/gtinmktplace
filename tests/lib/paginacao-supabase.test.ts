import { describe, it, expect, vi } from 'vitest';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';

/** Fake `pagina` que serve fatias de um array fixo respeitando o range pedido. */
function paginador(fonte: number[]) {
  return vi.fn((de: number, ate: number) =>
    Promise.resolve({ data: fonte.slice(de, ate + 1), error: null as { message: string } | null }),
  );
}

describe('buscarTodasPaginas', () => {
  it('1 página curta (< tamanho) → retorna tudo em 1 chamada', async () => {
    const p = paginador([1, 2, 3]);
    expect(await buscarTodasPaginas(p, 10)).toEqual([1, 2, 3]);
    expect(p).toHaveBeenCalledTimes(1);
  });

  it('2 páginas cheias + 1 curta → concatena na ordem e para na curta', async () => {
    const p = paginador([1, 2, 3, 4, 5]); // tamanho 2 → [1,2][3,4][5]
    expect(await buscarTodasPaginas(p, 2)).toEqual([1, 2, 3, 4, 5]);
    expect(p).toHaveBeenCalledTimes(3);
  });

  it('página exatamente cheia seguida de vazia → para na vazia (sem loop infinito)', async () => {
    const p = paginador([1, 2, 3, 4]); // tamanho 2 → [1,2][3,4][]
    expect(await buscarTodasPaginas(p, 2)).toEqual([1, 2, 3, 4]);
    expect(p).toHaveBeenCalledTimes(3);
  });

  it('error numa página → lança', async () => {
    const p = vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }));
    await expect(buscarTodasPaginas(p, 2)).rejects.toThrow('boom');
  });
});
