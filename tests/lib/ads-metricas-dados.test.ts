import { describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: m.invoke } } }));

const { buscarMetricasAds } = await import('@/lib/ads-metricas-dados');
const pedido = { desde: '2026-10-01', ate: '2026-10-20', comparar: 'nenhum', escopo: 'conta' } as const;
const falha = (status: number, corpo: unknown) =>
  ({ data: null, error: { context: new Response(JSON.stringify(corpo), { status }) } });

describe('buscarMetricasAds', () => {
  it('erro no formato { error } (requireUserOrg) preserva a mensagem', async () => {
    m.invoke.mockResolvedValue(falha(401, { error: 'Sessão expirada. Recarregue a página.' }));
    await expect(buscarMetricasAds(pedido)).rejects.toThrow('Sessão expirada. Recarregue a página.');
  });

  it('erro no formato { erro, motivo } do handler', async () => {
    m.invoke.mockResolvedValue(falha(400, { ok: false, erro: 'pedido inválido', motivo: 'futuro' }));
    await expect(buscarMetricasAds(pedido)).rejects.toThrow('pedido inválido: futuro');
  });
});
