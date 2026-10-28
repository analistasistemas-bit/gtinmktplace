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

describe('lerPackMarcandoLido: paginação (paging.total)', () => {
  // Fake do ML: `total` mensagens, `porPagina` por página, responde pelo offset da URL.
  const paginado = (total: number, porPagina = 10, cortaEm = Infinity) => vi.fn(async (url: string) => {
    const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
    const fim = Math.min(total, cortaEm, offset + porPagina);
    const messages = Array.from({ length: Math.max(0, fim - offset) }, (_, i) => ({ id: `m${offset + i}` }));
    return new Response(JSON.stringify({ paging: { total, offset, limit: porPagina }, messages }), { status: 200 });
  }) as unknown as typeof fetch;

  it('lê todas as páginas marcando como lida em cada uma', async () => {
    const f = paginado(30);
    const msgs = await lerPackMarcandoLido('t', 1, 2, f);
    expect(msgs.map((m) => m.id)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
    const urls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(3);
    for (const u of urls) expect(u).toContain('mark_as_read=true');
  });
  it('página vazia antes do total → lança (não reporta sucesso parcial)', async () => {
    await expect(lerPackMarcandoLido('t', 1, 2, paginado(30, 10, 15))).rejects.toThrow(/página/);
  });
});
