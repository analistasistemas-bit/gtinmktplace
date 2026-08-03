import { describe, expect, it, vi } from 'vitest';
import { memoizarPorChave } from '../memoizar-por-chave.ts';

describe('memoizarPorChave', () => {
  it('executa uma vez só para a mesma chave (o caso do upsert de fila em loop)', async () => {
    const fn = vi.fn(async () => {});
    const memo = memoizarPorChave(fn);

    for (let i = 0; i < 1000; i++) await memo('estoque-org1');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('chaves diferentes são independentes', async () => {
    const fn = vi.fn(async () => {});
    const memo = memoizarPorChave(fn);

    await memo('publish-shopee-org1');
    await memo('publish-shopee-org2');
    await memo('publish-shopee-org1');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls.map((c) => c[0])).toEqual(['publish-shopee-org1', 'publish-shopee-org2']);
  });

  it('chamadas concorrentes com a mesma chave compartilham um único voo', async () => {
    let resolver!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { resolver = r; }));
    const memo = memoizarPorChave(fn);

    const p1 = memo('fila');
    const p2 = memo('fila');
    resolver();
    await Promise.all([p1, p2]);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falha NÃO é memoizada — a próxima chamada tenta de novo', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('QStash 429'))
      .mockResolvedValueOnce(undefined);
    const memo = memoizarPorChave(fn);

    await expect(memo('fila')).rejects.toThrow('QStash 429');
    await expect(memo('fila')).resolves.toBeUndefined();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propaga o erro para o chamador (não engole a falha do upsert)', async () => {
    const fn = vi.fn(async () => { throw new Error('sem permissão'); });
    const memo = memoizarPorChave(fn);

    await expect(memo('fila')).rejects.toThrow('sem permissão');
  });

  it('depois de um sucesso, chamadas seguintes não repetem mesmo tendo falhado antes', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transitório'))
      .mockResolvedValue(undefined);
    const memo = memoizarPorChave(fn);

    await expect(memo('fila')).rejects.toThrow('transitório');
    await memo('fila');
    await memo('fila');
    await memo('fila');

    expect(fn).toHaveBeenCalledTimes(2); // 1 falha + 1 sucesso; as 2 últimas vieram do cache
  });
});
