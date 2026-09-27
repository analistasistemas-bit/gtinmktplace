// ADR-0173: disparador em fan-out (flag FANOUT_PULSE) vs. laço legado (sem a flag). Captura o
// handler passado a Deno.serve (mesmo padrão de responder-mensagem/__tests__/cancelado.test.ts).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cicloHoraUtc } from '../../_shared/rodada/rodada.ts';

const fronteiras = vi.hoisted(() => ({
  serve: vi.fn(),
  fanoutAtivo: vi.fn(() => false),
  publicarDisparo: vi.fn(async () => 0),
  processarColetaOrg: vi.fn(async () => ({ produtos: 0, gravadas: 0, alertas: 0 })),
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: vi.fn() }));
vi.mock('../../_shared/queue.ts', () => ({ verificarAssinatura: vi.fn(async () => true), qstashClient: vi.fn() }));
vi.mock('../../_shared/produto/modulo.ts', () => ({ exigirModulo: vi.fn(async () => true) }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn() }));
vi.mock('../../_shared/rodada/deps.ts', () => ({
  depsRodada: vi.fn(), publicarDisparo: fronteiras.publicarDisparo, fanoutAtivo: fronteiras.fanoutAtivo, urlDaFuncao: vi.fn(),
}));
vi.mock('../processar.ts', () => ({
  prepararContexto: vi.fn(), sincronizarRadar: vi.fn(), processarLoteProdutos: vi.fn(), notificarRodadaPulse: vi.fn(),
  processarColetaOrg: fronteiras.processarColetaOrg,
}));

// Duas tabelas: marketplace_connections (org_id + linha completa) e organizations (módulo).
function fakeAdmin(conexoes: Array<{ org_id: string }>, orgs: Array<{ id: string; modulos_habilitados: string[] }>) {
  function chain(rows: unknown[]) {
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api,
      then: (resolve: (x: { data: unknown; error: null }) => unknown) => resolve({ data: rows, error: null }),
    };
    return api;
  }
  return {
    from: (t: string) => {
      if (t === 'organizations') return chain(orgs);
      if (t === 'marketplace_connections') {
        return chain(conexoes.map((c) => ({ id: `cx-${c.org_id}`, org_id: c.org_id, canal: 'mercado_livre', conta_externa_id: '999', expires_at: null })));
      }
      throw new Error(`tabela inesperada: ${t}`);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: vi.fn() }));

type Mod = typeof import('../index.ts');
let handler: (req: Request) => Promise<Response>;
let adminClientMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: fronteiras.serve, env: { get: () => undefined } });
  await import('../index.ts');
  handler = fronteiras.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
  ({ adminClient: adminClientMock } = await import('../../_shared/supabase.ts') as unknown as { adminClient: ReturnType<typeof vi.fn> });
});

beforeEach(() => {
  fronteiras.publicarDisparo.mockClear();
  fronteiras.processarColetaOrg.mockClear();
});

const requisicaoQstash = (bodyObj: unknown) => new Request('http://localhost', {
  method: 'POST', headers: { 'upstash-signature': 'sig' }, body: JSON.stringify(bodyObj),
});

describe('disparador (ADR-0173, FANOUT_PULSE)', () => {
  it("com flag: {tier:'quente'} → disparo pulse-quente, ciclo por hora, só orgs com módulo pulse", async () => {
    fronteiras.fanoutAtivo.mockReturnValue(true);
    (adminClientMock as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeAdmin(
      [{ org_id: 'org-1' }, { org_id: 'org-2' }],
      [{ id: 'org-1', modulos_habilitados: ['pulse'] }, { id: 'org-2', modulos_habilitados: [] }],
    ));

    const res = await handler(requisicaoQstash({ tier: 'quente' }));
    expect(res.status).toBe(200);
    expect(fronteiras.publicarDisparo).toHaveBeenCalledTimes(1);
    const [fn, msgs] = fronteiras.publicarDisparo.mock.calls[0];
    expect(fn).toBe('pulse-coletar');
    expect(msgs).toEqual([{ modo: 'org', job: 'pulse-quente', org_id: 'org-1', ciclo: cicloHoraUtc(new Date()), params: { tier: 'quente' } }]);
    expect(fronteiras.processarColetaOrg).not.toHaveBeenCalled();
  });

  it("com flag: sem tier (default completo) → job pulse-completo", async () => {
    fronteiras.fanoutAtivo.mockReturnValue(true);
    (adminClientMock as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeAdmin(
      [{ org_id: 'org-1' }], [{ id: 'org-1', modulos_habilitados: ['pulse'] }],
    ));
    await handler(requisicaoQstash({}));
    expect(fronteiras.publicarDisparo.mock.calls[0][1][0]).toMatchObject({ job: 'pulse-completo', params: { tier: 'completo' } });
  });

  it('sem flag: laço legado — não publica disparo, chama processarColetaOrg por conexão', async () => {
    fronteiras.fanoutAtivo.mockReturnValue(false);
    (adminClientMock as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeAdmin(
      [{ org_id: 'org-1' }], [{ id: 'org-1', modulos_habilitados: ['pulse'] }],
    ));
    const res = await handler(requisicaoQstash({ tier: 'quente' }));
    expect(res.status).toBe(200);
    expect(fronteiras.publicarDisparo).not.toHaveBeenCalled();
    expect(fronteiras.processarColetaOrg).toHaveBeenCalledTimes(1);
    expect(fronteiras.processarColetaOrg.mock.calls[0].slice(2)).toEqual(['org-1', 'quente', 100, false]);
  });
});
