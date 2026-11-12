// ADR-0204: o mapeador do front envia `galeria` (ids que o operador manteve) por kit.
import { describe, expect, it, vi } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: mockInvoke } } }));

const { criarKitVinculado } = await import('../kit');
import type { KitFormValues } from '../kit';

const KIT: KitFormValues = {
  multiplicador: 2, chaveCadastro: 'c2', titulo: 'Kit', descricao: 'd', preco: 10, gtin: null,
  imagemPath: null, alturaCm: 1, larguraCm: 1, comprimentoCm: 1, atacado: null,
};

describe('criarKitVinculado — galeria', () => {
  it('envia galeria por kit quando existe; omite quando não', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await criarKitVinculado({ familiaBaseId: 'f', kits: [{ ...KIT, galeria: ['p1', 'p2'] }, { ...KIT, multiplicador: 3 }] });
    const kits = mockInvoke.mock.calls[0][1].body.kits;
    expect(kits[0].galeria).toEqual(['p1', 'p2']);
    expect(kits[1]).not.toHaveProperty('galeria');
  });
});
