import { describe, it, expect, vi, beforeEach } from 'vitest';

// ADR-0208: fetchAliquotas devolve o histórico e LANÇA se qualquer leitura falhar — devolver
// `[]`/8-16/alíquotas atuais reaplicaria o imposto de hoje às vendas antigas em silêncio.
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }));

const { useAuthStore } = await import('@/stores/auth-store');
const { fetchAliquotas } = await import('../queries');

useAuthStore.setState({
  profile: { id: 'u1', is_admin: true, is_active: true, allowed_menus: [], nome: 'Admin', org_id: 'org-1', is_super_admin: false },
});

type Res = { data: unknown; error: unknown };
function banco(cfg: Res, vig: Res) {
  const orgs: unknown[] = [];
  mockFrom.mockImplementation((tabela: string) => ({
    select: () => ({
      eq: (_c: string, v: unknown) => {
        orgs.push([tabela, v]);
        return tabela === 'configuracoes' ? { maybeSingle: () => Promise.resolve(cfg) } : Promise.resolve(vig);
      },
    }),
  }));
  return orgs;
}
const cfgOk: Res = { data: { aliquota_nacional_pct: 6.5, aliquota_importado_pct: 0, aliquotas_confirmadas_em: '2026-11-17T12:40:00Z',
  uf_empresa: 'PE', aliquota_interna_pct: 6.5 }, error: null };

describe('fetchAliquotas — vigências', () => {
  beforeEach(() => mockFrom.mockReset());

  it('mapeia vigente_desde → vigenteDesde e filtra por org_id', async () => {
    const orgs = banco(cfgOk, { data: [
      { vigente_desde: '1970-01-01T00:00:00Z', nacional_pct: 4, importado_pct: 0, uf_empresa: 'PE', interna_pct: 4 },
      { vigente_desde: '2026-11-17T12:40:00Z', nacional_pct: 6.5, importado_pct: 0, uf_empresa: null, interna_pct: null },
    ], error: null });
    const r = await fetchAliquotas();
    expect(r.vigencias).toEqual([
      { vigenteDesde: '1970-01-01T00:00:00Z', nacional: 4, importado: 0, ufEmpresa: 'PE', internaPct: 4 },
      { vigenteDesde: '2026-11-17T12:40:00Z', nacional: 6.5, importado: 0, ufEmpresa: null, internaPct: null },
    ]);
    expect(orgs).toContainEqual(['aliquotas_vigencia', 'org-1']);
  });

  it('org que nunca confirmou: vigencias []', async () => {
    banco({ data: null, error: null }, { data: [], error: null });
    expect((await fetchAliquotas()).vigencias).toEqual([]);
  });

  it('erro em configuracoes lança (não cai em 8/16)', async () => {
    banco({ data: null, error: new Error('cfg') }, { data: [], error: null });
    await expect(fetchAliquotas()).rejects.toThrow('cfg');
  });

  it('erro em aliquotas_vigencia lança (não devolve [])', async () => {
    banco(cfgOk, { data: null, error: new Error('vig') });
    await expect(fetchAliquotas()).rejects.toThrow('vig');
  });
});
