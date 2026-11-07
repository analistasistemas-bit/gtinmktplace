import { describe, it, expect, vi } from 'vitest';
import { retomarTransferenciasParadas } from '../transferencias.ts';

const AGORA = Date.parse('2026-11-07T12:00:00.000Z');
const LINHAS = [
  { id: 'T-2d', org_id: 'O', estado: 'ativa', passo_em: '2026-11-05T12:00:00.000Z' },
  { id: 'T-viva', org_id: 'O', estado: 'ativa', passo_em: '2026-11-07T11:58:00.000Z' },
  { id: 'T-travada', org_id: 'O', estado: 'travada', passo_em: '2026-11-01T12:00:00.000Z' },
];

function falso(erro = false) {
  const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
    lt: (c: string, v: string) => { filtros.push((r) => Date.parse(r[c] as string) < Date.parse(v)); return api; },
    then: (res: (v: unknown) => unknown) => Promise.resolve(erro
      ? { data: null, error: { message: 'boom' } }
      : { data: LINHAS.filter((r) => filtros.every((f) => f(r))), error: null }).then(res),
  };
  return { from: () => api } as never;
}

describe('retomarTransferenciasParadas', () => {
  it('reenfileira transferência ativa parada há 2 dias; ignora a viva e a travada', async () => {
    const enfileirar = vi.fn(async () => {});
    expect(await retomarTransferenciasParadas(falso(), enfileirar, AGORA)).toBe(1);
    expect(enfileirar).toHaveBeenCalledTimes(1);
    expect(enfileirar).toHaveBeenCalledWith('T-2d', 'O');
  });

  it('falha de enfileirar numa não derruba as outras nem a reconciliação', async () => {
    const enfileirar = vi.fn(async () => { throw new Error('qstash'); });
    expect(await retomarTransferenciasParadas(falso(), enfileirar, AGORA)).toBe(0);
  });

  it('falha de leitura lança', async () => {
    await expect(retomarTransferenciasParadas(falso(true), vi.fn(), AGORA)).rejects.toThrow();
  });
});
