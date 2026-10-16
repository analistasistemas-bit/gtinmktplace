import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
import { baixarNotasMes, ErroPacote } from '../baixar';
import { ErroDownloadIncompleto } from '../tipos';
import { zip, nfe } from './fixtures';

const resp = (body: BodyInit | null, init: ResponseInit) => new Response(body, init);
const ZIPH = (org = 'org-1') => ({ 'Content-Type': 'application/octet-stream', 'X-Org-Id': org, 'X-Conta-Ml': '99' });
beforeEach(() => { vi.unstubAllGlobals(); });

describe('baixarNotasMes', () => {
  it('preserva os bytes de um zip real e devolve a conta', async () => {
    const bytes = zip({ 'a.xml': nfe({ n: 1 }) });
    const f = vi.fn<typeof fetch>(async () => resp(bytes, { status: 200, headers: ZIPH() }));
    vi.stubGlobal('fetch', f);
    const r = await baixarNotasMes('2026-09', 'org-1');
    expect(r).toEqual({ tipo: 'zip', bytes, contaMl: '99' });
    expect(String(f.mock.calls[0][0])).toMatch(/\/functions\/v1\/baixar-notas-venda$/);
    expect(f.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });
  it('org divergente recusa', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(new Uint8Array([1]), { status: 200, headers: ZIPH('org-2') })));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toThrow('A organização mudou durante o download — gere o pacote de novo.');
  });
  it('vazio e erro com mensagem do servidor', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(JSON.stringify({ vazio: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-1', 'X-Conta-Ml': '99' } })));
    expect(await baixarNotasMes('2026-09', 'org-1')).toEqual({ tipo: 'vazio', contaMl: '99' });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(JSON.stringify({ error: 'limite' }), { status: 429, headers: { 'Content-Type': 'application/json' } })));
    const e = await baixarNotasMes('2026-09', 'org-1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroPacote);
    expect(e).toMatchObject({ message: 'limite', status: 429 });
  });
  it('cancelamento durante a leitura do JSON continua AbortError', async () => {
    const spy = vi.spyOn(Response.prototype, 'json').mockRejectedValue(new DOMException('cancelado', 'AbortError'));
    try {
      const h = { 'Content-Type': 'application/json', 'X-Conta-Ml': '99' };
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp('{}', { status: 200, headers: { ...h, 'X-Org-Id': 'org-1' } })));
      await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toMatchObject({ name: 'AbortError' });
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp('{}', { status: 500, headers: h })));
      await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toMatchObject({ name: 'AbortError' });
    } finally { spy.mockRestore(); }
  });
  it('corpo cortado no meio vira ErroDownloadIncompleto; cancelamento continua AbortError', async () => {
    const quebrado = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0x50, 0x4b])); c.error(new TypeError('terminated')); } });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(quebrado, { status: 200, headers: ZIPH() })));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toBeInstanceOf(ErroDownloadIncompleto);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new DOMException('cancelado', 'AbortError'); }));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
