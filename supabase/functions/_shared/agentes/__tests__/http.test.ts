import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResultadoAuthAgente } from '../auth-agente.ts';
import { tratarRequisicao } from '../http.ts';

const OK: ResultadoAuthAgente = { ok: true, conexaoId: 'con-A', orgId: 'org-A' };

function deps(auth: ResultadoAuthAgente = OK) {
  return {
    autenticar: vi.fn(async (_req: Request) => auth),
    despachar: vi.fn(async (corpo: unknown, a: { conexaoId: string; orgId: string }) =>
      ({ status: 200, corpo: { eco: corpo, ...a } as unknown })),
  };
}
const post = (corpo: string, headers: Record<string, string> = {}) =>
  new Request('https://x/agentes', { method: 'POST', body: corpo, headers });
/** Corpo em fluxo, sem content-length. `fim = false` nunca termina. */
function fluxo(pedacos: Uint8Array[], fim = true) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pedacos) c.enqueue(p);
      if (fim) c.close();
    },
  });
  return new Request('https://x/agentes', { method: 'POST', body, duplex: 'half' } as RequestInit);
}

afterEach(() => vi.restoreAllMocks());

describe('tratarRequisicao', () => {
  it('GET → 405 sem autenticar', async () => {
    const d = deps();
    const r = await tratarRequisicao(new Request('https://x/agentes'), d);
    expect(r.status).toBe(405);
    expect(r.headers.get('Allow')).toBe('POST');
    expect(d.autenticar).not.toHaveBeenCalled();
  });

  it('content-length acima de 64 KiB → 413 sem autenticar', async () => {
    const d = deps();
    const r = await tratarRequisicao(post('{}', { 'content-length': '65537' }), d);
    expect(r.status).toBe(413);
    expect(d.autenticar).not.toHaveBeenCalled();
  });

  it('corpo em fluxo acima de 64 KiB sem content-length → 413, sem despachar', async () => {
    const d = deps();
    const r = await tratarRequisicao(fluxo([new Uint8Array(40_000), new Uint8Array(30_000)]), d);
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ erro: 'corpo_grande' });
    expect(d.despachar).not.toHaveBeenCalled();
  });

  it('corpo que não termina em 10 s (aqui 20 ms) → 408 tempo_esgotado', async () => {
    const d = deps();
    const r = await tratarRequisicao(fluxo([new TextEncoder().encode('{"jsonrpc"')], false), d, 20);
    expect(r.status).toBe(408);
    expect(await r.json()).toEqual({ erro: 'tempo_esgotado' });
    expect(d.despachar).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'nao_autorizado', { 'www-authenticate': 'Bearer' }],
    [403, 'acesso_desligado', {}],
    [429, 'limite', { 'retry-after': '60' }],
    [503, 'indisponivel', {}],
  ] as const)('recusa %s → corpo fixo e cabeçalhos; corpo nunca lido nem despachado', async (status, codigo, cab) => {
    const d = deps({ ok: false, status, codigo } as ResultadoAuthAgente);
    const req = post('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    const r = await tratarRequisicao(req, d);
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual({ erro: codigo });
    for (const [k, v] of Object.entries(cab)) expect(r.headers.get(k)).toBe(v);
    if (status !== 401) expect(r.headers.get('www-authenticate')).toBeNull();
    expect(req.bodyUsed).toBe(false);
    expect(d.despachar).not.toHaveBeenCalled();
  });

  it('corpo não JSON → -32700 sem despachar', async () => {
    const d = deps();
    const r = await tratarRequisicao(post('{nao json'), d);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
    expect(d.despachar).not.toHaveBeenCalled();
  });

  it('despachar lançando → 503 sem a mensagem', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps();
    d.despachar.mockRejectedValue(new Error('segredo da org B'));
    const r = await tratarRequisicao(post('{}'), d);
    expect(r.status).toBe(503);
    const txt = await r.text();
    expect(JSON.parse(txt)).toEqual({ erro: 'indisponivel' });
    expect(txt + JSON.stringify(log.mock.calls)).not.toContain('segredo');
  });

  it('autenticar lançando → 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps();
    d.autenticar.mockRejectedValue(new Error('x'));
    expect((await tratarRequisicao(post('{}'), d)).status).toBe(503);
  });

  it('despachar com corpo null → status sem corpo (202)', async () => {
    const d = deps();
    d.despachar.mockResolvedValue({ status: 202, corpo: null });
    const r = await tratarRequisicao(post('{"jsonrpc":"2.0","method":"notifications/initialized"}'), d);
    expect(r.status).toBe(202);
    expect(await r.text()).toBe('');
  });

  it('despachar recebe exatamente a org e a conexão autenticadas; duas orgs nunca se cruzam', async () => {
    const porChave: Record<string, ResultadoAuthAgente> = {
      A: { ok: true, conexaoId: 'con-A', orgId: 'org-A' },
      B: { ok: true, conexaoId: 'con-B', orgId: 'org-B' },
    };
    const d = {
      autenticar: vi.fn(async (req: Request) => porChave[req.headers.get('x-chave')!]),
      despachar: vi.fn(async (corpo: unknown, a: { conexaoId: string; orgId: string }) => ({ status: 200, corpo: { corpo, ...a } as unknown })),
    };
    const [ra, rb] = await Promise.all([
      tratarRequisicao(post('{"q":"a"}', { 'x-chave': 'A' }), d),
      tratarRequisicao(post('{"q":"b"}', { 'x-chave': 'B' }), d),
    ]);
    expect(await ra.json()).toEqual({ corpo: { q: 'a' }, conexaoId: 'con-A', orgId: 'org-A' });
    expect(await rb.json()).toEqual({ corpo: { q: 'b' }, conexaoId: 'con-B', orgId: 'org-B' });
    expect(d.despachar.mock.calls.map((c) => c[1])).toEqual(
      expect.arrayContaining([{ conexaoId: 'con-A', orgId: 'org-A' }, { conexaoId: 'con-B', orgId: 'org-B' }]),
    );
    for (const c of d.despachar.mock.calls) expect(Object.keys(c[1]).sort()).toEqual(['conexaoId', 'orgId']);
  });
});

describe('alarme de recusas', () => {
  const recusa = (status: 401 | 403 | 429 | 503, codigo: 'nao_autorizado' | 'acesso_desligado' | 'limite' | 'indisponivel') =>
    ({ ...deps({ ok: false, status, codigo }), aoRecusar: vi.fn() });

  it.each([[401, 'nao_autorizado'], [429, 'limite'], [503, 'indisponivel']] as const)('%i conta uma vez e responde igual', async (status, codigo) => {
    const d = recusa(status, codigo);
    const r = await tratarRequisicao(post('{}'), d);
    const igual = await tratarRequisicao(post('{}'), deps({ ok: false, status, codigo }));
    expect(d.aoRecusar).toHaveBeenCalledTimes(1);
    expect([r.status, await r.text(), [...r.headers]]).toEqual([igual.status, await igual.text(), [...igual.headers]]);
  });

  it('503 por exceção inesperada também conta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = { ...deps(), despachar: vi.fn(async () => { throw new Error('x'); }), aoRecusar: vi.fn() };
    expect((await tratarRequisicao(post('{}'), d)).status).toBe(503);
    expect(d.aoRecusar).toHaveBeenCalledTimes(1);
  });

  it('403, 405, 413 e sucesso não contam', async () => {
    const d = recusa(403, 'acesso_desligado');
    await tratarRequisicao(post('{}'), d);
    await tratarRequisicao(new Request('https://x/agentes'), d);
    await tratarRequisicao(post('{}', { 'content-length': '65537' }), d);
    const bom = { ...deps(), aoRecusar: vi.fn() };
    await tratarRequisicao(post('{}'), bom);
    expect(d.aoRecusar).not.toHaveBeenCalled();
    expect(bom.aoRecusar).not.toHaveBeenCalled();
  });

  it('alarme que lança não muda a recusa', async () => {
    const d = { ...recusa(401, 'nao_autorizado'), aoRecusar: () => { throw new Error('x'); } };
    expect((await tratarRequisicao(post('{}'), d)).status).toBe(401);
  });
});
