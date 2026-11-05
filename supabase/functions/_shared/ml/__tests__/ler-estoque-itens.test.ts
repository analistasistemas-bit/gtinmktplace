import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerEstoqueItens } from '../ler-estoque-itens';

afterEach(() => { vi.unstubAllGlobals(); });

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('lerEstoqueItens (ADR-0195)', () => {
  it('lê total e variações pelo bulk, casando por variação', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => resposta([
      { status_code: 200, body: { id: 'MLB1', available_quantity: 5, variations: [{ id: 11, available_quantity: 2 }, { id: 12, available_quantity: 3 }] } },
      { status_code: 200, body: { id: 'MLB2', available_quantity: 7, variations: [] } },
    ]));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await lerEstoqueItens('tok', ['MLB1', 'MLB2']);
    expect(r).toEqual({
      MLB1: { total: 5, porVariacao: { 11: 2, 12: 3 } },
      MLB2: { total: 7, porVariacao: {} },
    });
    expect(fetchSpy.mock.calls[0][0]).toContain('/items/bulk?ids=MLB1,MLB2');
    expect(fetchSpy.mock.calls[0][0]).toContain('body.available_quantity');
    expect(fetchSpy.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('divide em blocos de 20', async () => {
    const fetchSpy = vi.fn(async (_url: string) => resposta([]));
    vi.stubGlobal('fetch', fetchSpy);
    await lerEstoqueItens('tok', Array.from({ length: 21 }, (_, i) => `MLB${i}`));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('HTTP não-ok do bloco marca os itens como erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta({ message: 'rate' }, 429)));
    expect(await lerEstoqueItens('tok', ['MLB1'])).toEqual({ MLB1: 'erro' });
  });

  it('exceção de rede marca os itens como erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede'); }));
    expect(await lerEstoqueItens('tok', ['MLB1'])).toEqual({ MLB1: 'erro' });
  });

  it('status_code diferente de 200 marca só aquele item', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta([
      { status_code: 200, body: { id: 'MLB1', available_quantity: 1, variations: [] } },
      { status_code: 404 },
    ])));
    expect(await lerEstoqueItens('tok', ['MLB1', 'MLB2'])).toEqual({
      MLB1: { total: 1, porVariacao: {} }, MLB2: 'erro',
    });
  });

  it('item ausente da resposta é erro, nunca saldo zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta([])));
    expect(await lerEstoqueItens('tok', ['MLB1'])).toEqual({ MLB1: 'erro' });
  });
});
