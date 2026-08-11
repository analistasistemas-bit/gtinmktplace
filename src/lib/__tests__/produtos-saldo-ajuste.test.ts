import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { ajustarEstoque } from '@/lib/produtos-saldo';

beforeEach(() => invoke.mockReset());

describe('ajustarEstoque', () => {
  it('envia a lista e devolve o resultado por item', async () => {
    invoke.mockResolvedValue({
      data: { resultados: [{ codigo: 'A', estoque: 0, duplicada: false }], pushOk: true },
      error: null,
    });
    const r = await ajustarEstoque({ ajustes: [{ codigo: 'A', novoSaldo: 0 }], ref: 'r1' });
    expect(invoke).toHaveBeenCalledWith('ajustar-estoque', {
      body: { ajustes: [{ codigo: 'A', novoSaldo: 0 }], observacao: null, ref: 'r1' },
    });
    expect(r).toEqual({ resultados: [{ codigo: 'A', estoque: 0, duplicada: false }], pushOk: true });
  });

  it('trata pushOk ausente como sucesso, igual à entrada', async () => {
    invoke.mockResolvedValue({ data: { resultados: [] }, error: null });
    const r = await ajustarEstoque({ ajustes: [{ codigo: 'A', novoSaldo: 0 }], ref: 'r1' });
    expect(r.pushOk).toBe(true);
  });

  it('preserva pushOk=false — a tela precisa avisar', async () => {
    invoke.mockResolvedValue({ data: { resultados: [], pushOk: false }, error: null });
    const r = await ajustarEstoque({ ajustes: [{ codigo: 'A', novoSaldo: 0 }], ref: 'r1' });
    expect(r.pushOk).toBe(false);
  });

  it('propaga erro da edge', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('403') });
    await expect(ajustarEstoque({ ajustes: [{ codigo: 'A', novoSaldo: 0 }], ref: 'r1' })).rejects.toBeTruthy();
  });
});
