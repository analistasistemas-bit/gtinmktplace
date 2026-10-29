import { describe, expect, it, vi } from 'vitest';
import { ERRO_PACK_INDISPONIVEL, ERRO_RECONECTAR_ML, buscarMensagensPackEstrito, lerPackMarcandoLido } from '../mensagens-io';

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

// Fake sem `paging.total` (ausente ou null): `total` é o tamanho real do pack.
const semTotal = (total: number, paging?: null) => vi.fn(async (url: string) => {
  const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
  const messages = Array.from({ length: Math.max(0, Math.min(total, offset + 10) - offset) }, (_, i) => ({ id: `m${offset + i}` }));
  return new Response(JSON.stringify(paging === null ? { paging: { total: null }, messages } : { messages }), { status: 200 });
}) as unknown as typeof fetch;

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
  it('total ausente: 25 mensagens em páginas de 10 → 25 em 3 GETs', async () => {
    const f = semTotal(25);
    expect(await lerPackMarcandoLido('t', 1, 2, f)).toHaveLength(25);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
  it('total=null com 3 páginas → 25', async () => {
    expect(await lerPackMarcandoLido('t', 1, 2, semTotal(25, null))).toHaveLength(25);
  });
  it('servidor repetindo a 1ª página com total=25 → lança (paginação sem avanço)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      paging: { total: 25 }, messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` })),
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(lerPackMarcandoLido('t', 1, 2, f)).rejects.toThrow(/sem avanço/);
  });
});

describe('buscarMensagensPackEstrito: paginação', () => {
  const paginado = (total: number, porPagina = 10) => vi.fn(async (url: string) => {
    const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
    const fim = Math.min(total, offset + porPagina);
    const messages = Array.from({ length: Math.max(0, fim - offset) }, (_, i) => ({ id: `m${offset + i}` }));
    return new Response(JSON.stringify({ paging: { total, offset, limit: porPagina }, messages }), { status: 200 });
  }) as unknown as typeof fetch;

  it('total=25, 10 por página → 25 mensagens em 3 GETs, mark_as_read=false', async () => {
    const f = paginado(25);
    const msgs = await buscarMensagensPackEstrito('t', 1, 2, f);
    expect(msgs).toHaveLength(25);
    const urls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(3);
    for (const u of urls) expect(u).toContain('mark_as_read=false');
  });
  it('falha na 2ª página lança (nunca sucesso parcial)', async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1
      ? new Response(JSON.stringify({ paging: { total: 25 }, messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` })) }), { status: 200 })
      : new Response('x', { status: 500 }))) as unknown as typeof fetch;
    await expect(buscarMensagensPackEstrito('t', 1, 2, f)).rejects.toThrow('ML /messages/packs 500');
  });
  it('total ausente com 25 mensagens → 25 em 3 GETs (variante estrita)', async () => {
    const f = semTotal(25);
    expect(await buscarMensagensPackEstrito('t', 1, 2, f)).toHaveLength(25);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
  it('404 na 1ª página → []', async () => {
    expect(await buscarMensagensPackEstrito('t', 1, 2, resp(404))).toEqual([]);
  });
});
