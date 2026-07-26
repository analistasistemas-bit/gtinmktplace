import { describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));

import { fetchSupportContext } from '../suporte';

describe('cliente de suporte', () => {
  it('trata 403 de contexto como ausência de sessão de suporte', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { status: 403 } });

    await expect(fetchSupportContext()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('suporte', { body: { action: 'context' } });
  });
});
