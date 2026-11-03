import { describe, expect, it, vi } from 'vitest';
import { createPlatformAdminHandler } from '../handler.ts';

const ORG = '90000000-0000-0000-0000-000000000001';
const ACTOR = '80000000-0000-0000-0000-000000000001';
const STATEMENT = '70000000-0000-0000-0000-000000000001';

function request(body: Record<string, unknown>, method = 'POST') {
  return new Request('http://local/platform-admin', { method, body: method === 'POST' ? JSON.stringify(body) : undefined });
}

function harness(overrides: { authenticate?: (req: Request) => Promise<{ userId: string }>; exists?: boolean } = {}) {
  const methods = ['wallet','organization','metrics','terms','saveTerms','preview','close','statements','statement','reconcile','pulseUsage','extensaoUsage','audit','monthlyReport','paymentProfile','savePaymentProfile'] as const;
  const repository: Record<string, ReturnType<typeof vi.fn>> = { organizationExists: vi.fn().mockResolvedValue(overrides.exists ?? true) };
  for (const method of methods) repository[method] = vi.fn().mockResolvedValue({ method });
  return {
    repository,
    handler: createPlatformAdminHandler({
      authenticate: overrides.authenticate ?? vi.fn().mockResolvedValue({ userId: ACTOR }),
      repository,
      corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    }),
  };
}

const PROFILE = { beneficiary_name: 'Daludi Teste', document: '11.222.333/0001-81', bank_name: 'Banco', branch: '0001', account: '123-4', pix_key_type: 'cnpj', pix_key: '11222333000181', city: 'Fortaleza' };

async function payload(response: Response) { return await response.json() as Record<string, unknown>; }

describe('createPlatformAdminHandler', () => {
  it('returns OPTIONS 204 and rejects non-POST methods', async () => {
    const { handler } = harness();
    expect((await handler(new Request('http://local', { method: 'OPTIONS' }))).status).toBe(204);
    expect((await handler(new Request('http://local', { method: 'GET' }))).status).toBe(405);
  });

  it('returns authentication Responses unchanged and rejects non-admin actors', async () => {
    const unauthorized = new Response(JSON.stringify({ error: 'jwt inválido' }), { status: 401, headers: { 'X-Auth': 'failed' } });
    const invalidJwt = harness({ authenticate: async () => { throw unauthorized; } });
    const response = await invalidJwt.handler(request({ action: 'wallet', month: '2026-08' }));
    expect(response).toBe(unauthorized);
    expect(response.headers.get('X-Auth')).toBe('failed');

    const nonAdmin = harness({ authenticate: async () => { throw new Error('platform admin required'); } });
    expect((await nonAdmin.handler(request({ action: 'wallet', month: '2026-08' }))).status).toBe(403);
  });

  it('rejects unknown actions, unknown organizations, and invalid bounded inputs', async () => {
    const { handler } = harness();
    expect((await handler(request({ action: 'wat' }))).status).toBe(400);
    expect((await harness({ exists: false }).handler(request({ action: 'terms', org_id: ORG }))).status).toBe(404);
    for (const body of [
      { action: 'metrics', org_id: 'bad', month: '2026-08' },
      { action: 'metrics', org_id: ORG, month: '2026-13' },
      { action: 'statements', org_id: ORG, month: '2026-8' },
      { action: 'wallet', month: '2026-08', page: 0 },
      { action: 'wallet', month: '2026-08', page_size: 51 },
      { action: 'wallet', month: '2026-08', sort: 'unknown' },
      { action: 'overview', month: '2026-08' },
      { action: 'list', month: '2026-08' },
    ]) expect((await handler(request(body))).status).toBe(400);
  });

  it.each([
    ['wallet', 'wallet', { month: '2026-08', page: 2, page_size: 10, sort: 'slug' }, [ACTOR, { month: '2026-08', search: undefined, include_test: false, include_archived: false, page: 2, page_size: 10, sort: 'slug' }]],
    ['organization', 'organization', { org_id: ORG, month: '2026-08' }, [ACTOR, ORG, '2026-08']],
    ['metrics', 'metrics', { org_id: ORG, month: '2026-08' }, [ACTOR, ORG, '2026-08']],
    ['terms', 'terms', { org_id: ORG }, [ACTOR, ORG]],
    ['save_terms', 'saveTerms', { org_id: ORG, starts_on: '2026-08-01', modality: 2, monthly_fee_cents: 0, revenue_bps_t1: 700, revenue_bps_t2: 600, revenue_bps_t3: 550, revenue_bps_t4: 500, sonar_unit_cents: 120, setup_fee_cents: 0, setup_due_month: null, reason: 'nova' }, [ACTOR, { org_id: ORG, starts_on: '2026-08-01', modality: 2, monthly_fee_cents: 0, revenue_bps_t1: 700, revenue_bps_t2: 600, revenue_bps_t3: 550, revenue_bps_t4: 500, sonar_unit_cents: 120, setup_fee_cents: 0, setup_due_month: null, reason: 'nova', due_day: 5 }]],
    ['preview', 'preview', { org_id: ORG, month: '2026-08' }, [ACTOR, ORG, '2026-08']],
    ['close', 'close', { org_id: ORG, month: '2026-08', expected_revision: 'rev' }, [ACTOR, ORG, '2026-08', 'rev']],
    ['statements', 'statements', { org_id: ORG, page: 2, page_size: 10 }, [ACTOR, ORG, 2, 10, undefined]],
    ['statements (competência)', 'statements', { org_id: ORG, month: '2026-08' }, [ACTOR, ORG, 1, 20, '2026-08']],
    ['statement', 'statement', { org_id: ORG, statement_id: STATEMENT }, [ACTOR, ORG, STATEMENT]],
    ['reconcile_revenue', 'reconcile', { org_id: ORG, sale_id: STATEMENT, source_updated_at: '2026-08-02T12:00:00Z', refunded_product_cents: 0, reason: 'evidência' }, [ACTOR, { org_id: ORG, sale_id: STATEMENT, source_updated_at: '2026-08-02T12:00:00Z', refunded_product_cents: 0, reason: 'evidência' }]],
    ['pulse_usage', 'pulseUsage', { org_id: ORG, month: '2026-08', page: 1, page_size: 20 }, [ACTOR, ORG, '2026-08', 1, 20]],
    ['extensao_usage', 'extensaoUsage', { org_id: ORG, month: '2026-10' }, [ACTOR, ORG, '2026-10']],
    ['payment_profile', 'paymentProfile', {}, [ACTOR]],
    ['save_payment_profile', 'savePaymentProfile', PROFILE, [ACTOR, { ...PROFILE, document: '11222333000181' }]],
    ['audit', 'audit', { org_id: ORG, month: '2026-08', category: 'billing', actor_id: ACTOR, result: 'success', page: 1, page_size: 20 }, [ACTOR, ORG, '2026-08', { category: 'billing', actor_id: ACTOR, result: 'success' }, 1, 20]],
  ])('dispatches %s with validated arguments', async (label, method, input, args) => {
    const action = label.split(' ')[0];
    const { handler, repository } = harness();
    const response = await handler(request({ action, ...input }));
    expect(response.status, JSON.stringify(await payload(response.clone()))).toBe(200);
    expect(repository[method]).toHaveBeenCalledWith(...args);
    if (['wallet', 'organization', 'payment_profile', 'save_payment_profile'].includes(action)) expect(repository.organizationExists).not.toHaveBeenCalled();
  });

  it('rejects an invalid payment profile with 400 before touching the repository', async () => {
    const { handler, repository } = harness();
    const response = await handler(request({ action: 'save_payment_profile', ...PROFILE, document: '11222333000180' }));
    expect(response.status).toBe(400);
    expect(repository.savePaymentProfile).not.toHaveBeenCalled();
  });

  it('returns 404 when the requested organization is missing', async () => {
    const { handler, repository } = harness();
    repository.organization.mockResolvedValue(null);
    const response = await handler(request({ action: 'organization', org_id: ORG, month: '2026-08' }));
    expect(response.status).toBe(404);
    expect(await payload(response)).toMatchObject({ code: 'organization_not_found' });
  });

  it('maps revision conflicts to 409', async () => {
    const { handler, repository } = harness();
    repository.close.mockRejectedValue(new Error('billing revision conflict'));
    expect((await handler(request({ action: 'close', org_id: ORG, month: '2026-08', expected_revision: 'old' }))).status).toBe(409);
  });

  it('maps a close without commercial terms to 422', async () => {
    const { handler, repository } = harness();
    repository.close.mockRejectedValue(new Error('commercial terms required'));
    const response = await handler(request({ action: 'close', org_id: ORG, month: '2026-08', expected_revision: 'rev' }));
    expect(response.status).toBe(422);
    expect(await payload(response)).toMatchObject({ code: 'commercial_terms_required' });
  });
});
