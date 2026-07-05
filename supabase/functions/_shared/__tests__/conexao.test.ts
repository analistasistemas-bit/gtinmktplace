import { describe, expect, it, vi } from 'vitest';
import { mapearConexao, resolverConexao } from '../canais/conexao.ts';

describe('mapearConexao', () => {
  it('mapeia linha → ConexaoCanal', () => {
    expect(mapearConexao({ id: 'c1', org_id: 'o1', canal: 'mercado_livre', conta_externa_id: '123', expires_at: '2026-01-01T00:00:00Z' }))
      .toEqual({ id: 'c1', orgId: 'o1', canal: 'mercado_livre', contaExternaId: '123', expiresAt: '2026-01-01T00:00:00Z' });
  });
  it('null → null', () => {
    expect(mapearConexao(null)).toBeNull();
  });
});

describe('resolverConexao', () => {
  const mkAdmin = (data: unknown) => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data }) }) }) }) }),
  }) as never;

  it('org com conexão → mapeada', async () => {
    const cx = await resolverConexao(mkAdmin({ id: 'c1', org_id: 'o1', canal: 'mercado_livre', conta_externa_id: '9', expires_at: null }), 'o1', 'mercado_livre');
    expect(cx).toEqual({ id: 'c1', orgId: 'o1', canal: 'mercado_livre', contaExternaId: '9', expiresAt: null });
  });
  it('org sem conexão → null', async () => {
    const cx = await resolverConexao(mkAdmin(null), 'o1', 'mercado_livre');
    expect(cx).toBeNull();
  });
});
