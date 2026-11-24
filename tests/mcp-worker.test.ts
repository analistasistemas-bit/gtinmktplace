// Worker de mcp.publiai.daludi.com.br (ADR-0210, Emenda 1): só repassa para a edge `agentes`.
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error módulo JS do Worker, sem tipos
import worker from '../infra/mcp-worker/src/index.js';

const DESTINO = 'https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/agentes';
const chamar = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://mcp.publiai.daludi.com.br${path}`, init));

afterEach(() => vi.restoreAllMocks());

describe('mcp-worker', () => {
  it('POST na raiz vai para a edge com método, corpo e Authorization intactos, sem Host', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":1}', { status: 200 }));
    const r = await chamar('/', { method: 'POST', headers: { Authorization: 'Bearer pai_x', 'Content-Type': 'application/json' }, body: '{"a":1}' });
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(url).toBe(DESTINO);
    expect(init.method).toBe('POST');
    expect(init.headers.get('authorization')).toBe('Bearer pai_x');
    expect(init.headers.get('host')).toBeNull();
    expect(await new Response(init.body).text()).toBe('{"a":1}');
  });

  it('/mcp também repassa; GET vai sem corpo (a edge responde 405)', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 405 }));
    expect((await chamar('/mcp')).status).toBe(405);
    expect((f.mock.calls[0][1] as RequestInit).body).toBeUndefined();
  });

  it('outros caminhos (inclusive descoberta OAuth) dão 404 sem tocar a edge', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    for (const p of ['/.well-known/oauth-protected-resource', '/qualquer', '/functions/v1/agentes']) {
      expect((await chamar(p)).status).toBe(404);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('favicon devolve o ícone do PubliAI como PNG', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('png', { status: 200 }));
    const r = await chamar('/favicon.ico');
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(f.mock.calls[0][0]).toBe('https://app.publiai.daludi.com.br/apple-touch-icon.png');
  });
});
