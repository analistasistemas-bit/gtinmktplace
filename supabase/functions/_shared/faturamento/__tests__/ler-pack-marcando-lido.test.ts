import { describe, expect, it, vi } from 'vitest';
import { ERRO_RECONECTAR_ML, lerPackMarcandoLido } from '../mensagens-io';

const resp = (status: number, corpo: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

describe('lerPackMarcandoLido', () => {
  it('chama o ML com mark_as_read=true e devolve as mensagens', async () => {
    const f = resp(200, { messages: [{ id: 'a' }] });
    expect(await lerPackMarcandoLido('t', 1, 2, f)).toEqual([{ id: 'a' }]);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('mark_as_read=true');
  });
  it('404 = pack sem mensagens', async () => {
    expect(await lerPackMarcandoLido('t', 1, 2, resp(404))).toEqual([]);
  });
  it('403 vira o erro de reconexão', async () => {
    await expect(lerPackMarcandoLido('t', 1, 2, resp(403))).rejects.toThrow(ERRO_RECONECTAR_ML);
  });
  it('429/5xx lançam', async () => {
    await expect(lerPackMarcandoLido('t', 1, 2, resp(500))).rejects.toThrow('ML /messages/packs 500');
  });
});
