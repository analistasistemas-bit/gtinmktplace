import { describe, expect, it, vi } from 'vitest';
import { recontarOuRemoverLote } from '../recontar';

function adminCom(select: { data: unknown; error: { message: string } | null }) {
  const deletes: string[] = [];
  const admin = {
    from: (tabela: string) => ({
      select: () => ({ eq: async () => select }),
      delete: () => ({ eq: async () => { deletes.push(tabela); return { error: null }; } }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  return { admin: admin as never, deletes };
}

describe('recontarOuRemoverLote', () => {
  // Revisão Codex (ADR-0185): erro de leitura virava "lote vazio" → DELETE do lote, com cascade
  // nas famílias que ainda estavam lá.
  it('erro ao ler as famílias → lança e NÃO apaga o lote', async () => {
    const { admin, deletes } = adminCom({ data: null, error: { message: 'timeout' } });
    await expect(recontarOuRemoverLote(admin, 'lote-1', false)).rejects.toThrow(/timeout/);
    expect(deletes).toEqual([]);
  });

  it('lote realmente vazio → remove', async () => {
    const { admin, deletes } = adminCom({ data: [], error: null });
    expect(await recontarOuRemoverLote(admin, 'lote-1', false)).toBe(true);
    expect(deletes).toEqual(['lotes']);
  });

  it('com famílias → reconta, não remove', async () => {
    const { admin, deletes } = adminCom({ data: [{ status: 'publicado' }], error: null });
    expect(await recontarOuRemoverLote(admin, 'lote-1', false)).toBe(false);
    expect(deletes).toEqual([]);
    vi.restoreAllMocks();
  });
});
