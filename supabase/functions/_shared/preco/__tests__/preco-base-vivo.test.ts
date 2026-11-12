import { describe, expect, it, vi } from 'vitest';
import { lerPrecoBaseVivo, precoBaseDoItem } from '../preco-base-vivo.ts';

describe('precoBaseDoItem', () => {
  it('em promoção (original_price > price) devolve o preço de tabela', () => {
    expect(precoBaseDoItem({ price: 64, original_price: 69.9 })).toBe(69.9);
  });
  it('sem promoção (original_price nulo) devolve o price', () => {
    expect(precoBaseDoItem({ price: 69.9, original_price: null })).toBe(69.9);
  });
  it('sem preço utilizável devolve null', () => {
    expect(precoBaseDoItem({ price: null, original_price: null })).toBeNull();
    expect(precoBaseDoItem({ price: 0 })).toBeNull();
  });
});

const resposta = (linhas: unknown[], ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => linhas }) as unknown as Response);

describe('lerPrecoBaseVivo', () => {
  it('usa o menor preço base entre os itens ativos lidos', async () => {
    const f = resposta([
      { status_code: 200, body: { id: 'MLB1', price: 64, original_price: 69.9, status: 'active' } },
      { status_code: 200, body: { id: 'MLB2', price: 69.9, original_price: null, status: 'active' } },
    ]);
    expect(await lerPrecoBaseVivo('tok', ['MLB1', 'MLB2'], f as unknown as typeof fetch)).toBe(69.9);
  });
  it('ignora item encerrado e item que não respondeu 200', async () => {
    const f = resposta([
      { status_code: 200, body: { id: 'MLB1', price: 10, original_price: null, status: 'closed' } },
      { status_code: 404 },
      { status_code: 200, body: { id: 'MLB3', price: 69.9, original_price: null, status: 'paused' } },
    ]);
    expect(await lerPrecoBaseVivo('tok', ['MLB1', 'MLB2', 'MLB3'], f as unknown as typeof fetch)).toBe(69.9);
  });
  it('fail-closed: HTTP de erro, sem ids ou nada legível → null (nunca um preço inventado)', async () => {
    expect(await lerPrecoBaseVivo('tok', ['MLB1'], resposta([], false) as unknown as typeof fetch)).toBeNull();
    expect(await lerPrecoBaseVivo('tok', [], resposta([]) as unknown as typeof fetch)).toBeNull();
    expect(await lerPrecoBaseVivo('tok', ['MLB1'], resposta([{ status_code: 404 }]) as unknown as typeof fetch)).toBeNull();
  });
  it('rede caindo → null', async () => {
    const f = vi.fn(async () => { throw new Error('rede'); });
    expect(await lerPrecoBaseVivo('tok', ['MLB1'], f as unknown as typeof fetch)).toBeNull();
  });
});
