import { describe, it, expect, vi } from 'vitest';
import { retomarTransferenciasParadas } from '../transferencias.ts';

const AGORA = Date.parse('2026-11-07T12:00:00.000Z');
const LINHAS = [
  { id: 'T-2d', org_id: 'O', estado: 'ativa', passo_em: '2026-11-05T12:00:00.000Z' },
  { id: 'T-viva', org_id: 'O', estado: 'ativa', passo_em: '2026-11-07T11:58:00.000Z' },
  { id: 'T-travada', org_id: 'O', estado: 'travada', passo_em: '2026-11-01T12:00:00.000Z' },
];

/** PostgREST falso: filtra, ordena e devolve no máximo 1.000 linhas por `range`, como o real. */
function falso(linhas: Array<Record<string, unknown>> = LINHAS, erro = false) {
  const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
  let ordem: string | null = null;
  let faixa: [number, number] = [0, 999];
  const ler = () => {
    if (erro) return { data: null, error: { message: 'boom' } };
    const todas = linhas.filter((r) => filtros.every((f) => f(r)));
    if (ordem) todas.sort((a, b) => String(a[ordem!]).localeCompare(String(b[ordem!])));
    return { data: todas.slice(faixa[0], Math.min(faixa[1] + 1, faixa[0] + 1000)), error: null };
  };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
    lt: (c: string, v: string) => { filtros.push((r) => Date.parse(r[c] as string) < Date.parse(v)); return api; },
    order: (c: string) => { ordem = c; return api; },
    range: (de: number, ate: number) => { faixa = [de, ate]; return api; },
    then: (res: (v: unknown) => unknown) => Promise.resolve(ler()).then(res),
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

  it('backlog acima de 1.000 é lido inteiro, sem repetir nem pular', async () => {
    const muitas = Array.from({ length: 2500 }, (_, i) => ({
      id: `T-${String(i).padStart(5, '0')}`, org_id: 'O', estado: 'ativa', passo_em: '2026-11-01T00:00:00.000Z',
    }));
    const enfileirar = vi.fn(async () => {});
    expect(await retomarTransferenciasParadas(falso(muitas), enfileirar, AGORA)).toBe(2500);
    expect(new Set(enfileirar.mock.calls.map((c) => c[0])).size).toBe(2500);
  });

  it('falha de enfileirar numa não derruba as outras nem a reconciliação', async () => {
    const enfileirar = vi.fn(async () => { throw new Error('qstash'); });
    expect(await retomarTransferenciasParadas(falso(), enfileirar, AGORA)).toBe(0);
  });

  it('falha de leitura lança', async () => {
    await expect(retomarTransferenciasParadas(falso(LINHAS, true), vi.fn(), AGORA)).rejects.toThrow();
  });
});
