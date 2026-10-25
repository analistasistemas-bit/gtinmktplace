import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { lerKpis } from '../kpis.ts';

const J = { desde: '2026-10-01T00:00:00-03:00', ate: '2026-10-24T00:00:00-03:00' };
const fake = (res: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(res);
  return { admin: { rpc } as unknown as SupabaseClient, rpc };
};

describe('lerKpis', () => {
  it('chama vendas_kpis_janela, converte numeric (string) e calcula o ticket', async () => {
    const { admin, rpc } = fake({ data: { faturamento: '1234.56', pedidos: 3 }, error: null });
    await expect(lerKpis(admin, 'org-1', J)).resolves.toEqual({ faturamento: 1234.56, pedidos: 3, ticket: 411.52 });
    expect(rpc).toHaveBeenCalledWith('vendas_kpis_janela', { p_org: 'org-1', p_desde: J.desde, p_ate: J.ate });
  });

  it('ticket com o round2 do motor (calcularResumo): 1,00 + 0,13 em 2 pedidos → 0,56', async () => {
    const { admin } = fake({ data: { faturamento: '1.13', pedidos: 2 }, error: null });
    await expect(lerKpis(admin, 'org-1', J)).resolves.toEqual({ faturamento: 1.13, pedidos: 2, ticket: 0.56 });
  });

  it('sem pedidos → ticket 0', async () => {
    const { admin } = fake({ data: { faturamento: 0, pedidos: 0 }, error: null });
    await expect(lerKpis(admin, 'org-1', J)).resolves.toEqual({ faturamento: 0, pedidos: 0, ticket: 0 });
  });

  it('erro do banco lança (nunca zera em silêncio)', async () => {
    const { admin } = fake({ data: null, error: { message: 'boom' } });
    await expect(lerKpis(admin, 'org-1', J)).rejects.toThrow('boom');
  });

  it('resposta vazia lança', async () => {
    const { admin } = fake({ data: null, error: null });
    await expect(lerKpis(admin, 'org-1', J)).rejects.toThrow();
  });
});
