import { describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
vi.mock('../supabase.ts', () => ({ adminClient: () => ({ auth: { getUser } }) }));

import { requireUser } from '../auth.ts';

// Sem CORS o browser bloqueia o 401 e o supabase-js mostra "Failed to send a request to the
// Edge Function" em vez de "sessão expirada" (sessão derrubada por logout em outra aba).
async function falha(req: Request): Promise<Response> {
  try { await requireUser(req); } catch (e) { return e as Response; }
  throw new Error('não lançou');
}

describe('requireUser', () => {
  it('401 sem bearer vem com CORS e corpo JSON', async () => {
    const r = await falha(new Request('http://x', { method: 'POST' }));
    expect(r.status).toBe(401);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await r.json()).error).toMatch(/sessão/i);
  });

  it('401 de sessão inexistente vem com CORS e corpo JSON', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Session not found' } });
    const r = await falha(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer t' } }));
    expect(r.status).toBe(401);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await r.json()).error).toMatch(/sessão/i);
  });
});
