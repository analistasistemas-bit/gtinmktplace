import { describe, expect, it, vi } from 'vitest';
import { ERRO_PACK_INDISPONIVEL, ERRO_RECONECTAR_ML, lerPackMarcandoLido } from '../mensagens-io';

const resp = (status: number, corpo: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

describe('lerPackMarcandoLido', () => {
  it('chama o ML com mark_as_read=true e devolve as mensagens', async () => {
    const f = resp(200, { messages: [{ id: 'a' }] });
    expect(await lerPackMarcandoLido('t', 1, 2, f)).toEqual([{ id: 'a' }]);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('mark_as_read=true');
  });
  it('R17: 404 pode ser temporário → lança (retentável), nunca "nada a marcar"', async () => {
    await expect(lerPackMarcandoLido('t', 1, 2, resp(404))).rejects.toThrow(ERRO_PACK_INDISPONIVEL);
  });
  it('403 vira o erro de reconexão', async () => {
    await expect(lerPackMarcandoLido('t', 1, 2, resp(403))).rejects.toThrow(ERRO_RECONECTAR_ML);
  });
  it('429/5xx lançam', async () => {
    await expect(lerPackMarcandoLido('t', 1, 2, resp(500))).rejects.toThrow('ML /messages/packs 500');
  });
});
