import { describe, expect, it } from 'vitest';
import { lerRegimeFiscalOrg } from '../regime.ts';

// A3 (auditoria fiscal 19/10): regime nunca presumido "simples".
function admin(res: { data?: { regime_tributario: string } | null; error?: { message: string } | null }) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null, ...res }) }) }) }) } as never;
}

describe('lerRegimeFiscalOrg (A3)', () => {
  it('simples → retorna "simples"', async () => {
    await expect(lerRegimeFiscalOrg(admin({ data: { regime_tributario: 'simples' } }), 'o1')).resolves.toBe('simples');
  });
  it('erro de leitura → lança SEM status (transitório)', async () => {
    const e = await lerRegimeFiscalOrg(admin({ error: { message: 'timeout' } }), 'o1').catch((x) => x);
    expect(e.message).toMatch(/empresa_fiscal: timeout/);
    expect(e.status).toBeUndefined();
  });
  it('empresa ausente → 400 nomeando o cadastro da empresa', async () => {
    const e = await lerRegimeFiscalOrg(admin({ data: null }), 'o1').catch((x) => x);
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/sem cadastro da empresa fiscal.*Configurações › Fiscal/);
  });
  it('regime normal → 400 definitivo (v1 só Simples)', async () => {
    const e = await lerRegimeFiscalOrg(admin({ data: { regime_tributario: 'normal' } }), 'o1').catch((x) => x);
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/só Simples Nacional.*"normal"/);
  });
});
