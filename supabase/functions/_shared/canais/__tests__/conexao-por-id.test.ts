import { describe, expect, it } from 'vitest';
import { resolverConexaoPorId } from '../conexao';

const fake = (row: unknown) => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) }),
}) as never;
const ROW = { id: 'c1', org_id: 'o1', canal: 'mercado_livre', conta_externa_id: '9', expires_at: null };

describe('resolverConexaoPorId (achado 2)', () => {
  it('resolve pelo id e deriva a org', async () => {
    expect((await resolverConexaoPorId(fake(ROW), 'c1'))?.orgId).toBe('o1');
  });
  it('org_id informado diferente da da conexão → null', async () => {
    expect(await resolverConexaoPorId(fake(ROW), 'c1', 'outra')).toBeNull();
    expect((await resolverConexaoPorId(fake(ROW), 'c1', 'o1'))?.id).toBe('c1');
  });
  it('conexão inexistente → null', async () => {
    expect(await resolverConexaoPorId(fake(null), 'x')).toBeNull();
  });
});
