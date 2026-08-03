import { describe, expect, it, vi } from 'vitest';
import { enfileirarEmBlocos } from '../enfileirar-em-blocos.ts';

interface Job { familia_id: string; lote_id: string }

function job(id: string): Job {
  return { familia_id: id, lote_id: 'lote-1' };
}

describe('enfileirarEmBlocos', () => {
  it('publica em 1 bloco quando <= tamanho do bloco, preservando a ordem dos messageIds', async () => {
    const publicar = vi.fn(async (msgs: { body: Job }[]) =>
      msgs.map((m) => ({ messageId: `msg-${m.body.familia_id}` })),
    );
    const jobs = [job('a'), job('b'), job('c')];

    const ids = await enfileirarEmBlocos(jobs, 'https://x/process-familia', publicar);

    expect(publicar).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(['msg-a', 'msg-b', 'msg-c']);
  });

  it('divide em blocos — 1 chamada por bloco, não por item', async () => {
    const publicar = vi.fn(async (msgs: { body: Job }[]) =>
      msgs.map((m) => ({ messageId: `msg-${m.body.familia_id}` })),
    );
    const jobs = Array.from({ length: 150 }, (_, i) => job(String(i)));

    const ids = await enfileirarEmBlocos(jobs, 'https://x/process-familia', publicar, 100);

    expect(publicar).toHaveBeenCalledTimes(2);
    expect(publicar.mock.calls[0][0]).toHaveLength(100);
    expect(publicar.mock.calls[1][0]).toHaveLength(50);
    expect(ids).toHaveLength(150);
    expect(ids[0]).toBe('msg-0');
    expect(ids[149]).toBe('msg-149');
  });

  it('quando o 2º bloco falha, propaga o erro do publicador', async () => {
    const publicar = vi.fn()
      .mockResolvedValueOnce([{ messageId: 'msg-0' }])
      .mockRejectedValueOnce(new Error('QStash indisponível'));
    const jobs = [job('0'), job('1')];

    await expect(enfileirarEmBlocos(jobs, 'https://x', publicar, 1)).rejects.toThrow('QStash indisponível');
  });

  it('expõe `enfileirados` = itens do(s) bloco(s) já publicado(s) antes da falha', async () => {
    const publicar = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ messageId: `msg-${i}` })))
      .mockRejectedValueOnce(new Error('falhou no 2º bloco'));
    const jobs = Array.from({ length: 150 }, (_, i) => job(String(i)));

    let erro: (Error & { enfileirados?: Job[] }) | null = null;
    try {
      await enfileirarEmBlocos(jobs, 'https://x', publicar, 100);
    } catch (e) {
      erro = e as Error & { enfileirados?: Job[] };
    }

    expect(erro).not.toBeNull();
    expect(erro!.enfileirados).toHaveLength(100);
    expect(erro!.enfileirados![0].familia_id).toBe('0');
    expect(erro!.enfileirados![99].familia_id).toBe('99');
  });

  it('falha alto (não corrompe em silêncio) se o batch devolver menos ids do que itens enviados', async () => {
    const publicar = vi.fn(async () => [{ messageId: 'msg-0' }]); // 1 resposta pra 2 jobs
    const jobs = [job('0'), job('1')];

    await expect(enfileirarEmBlocos(jobs, 'https://x', publicar)).rejects.toThrow(/devolveu 1 ids para 2 jobs/);
  });

  it('anexa `enfileirados` também quando é o mismatch de comprimento que falha (não só exceção do publicador)', async () => {
    const publicar = vi.fn()
      .mockResolvedValueOnce([{ messageId: 'msg-0' }, { messageId: 'msg-1' }])
      .mockResolvedValueOnce([{ messageId: 'msg-2' }]); // bloco 2 devolve 1 pra 2 jobs
    const jobs = [job('0'), job('1'), job('2'), job('3')];

    let erro: (Error & { enfileirados?: Job[] }) | null = null;
    try {
      await enfileirarEmBlocos(jobs, 'https://x', publicar, 2);
    } catch (e) {
      erro = e as Error & { enfileirados?: Job[] };
    }

    expect(erro).not.toBeNull();
    expect(erro!.enfileirados).toHaveLength(2);
    expect(erro!.enfileirados!.map((j) => j.familia_id)).toEqual(['0', '1']);
  });

  it('lista vazia não chama o publicador', async () => {
    const publicar = vi.fn();
    const ids = await enfileirarEmBlocos([], 'https://x', publicar);
    expect(publicar).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
  });
});
