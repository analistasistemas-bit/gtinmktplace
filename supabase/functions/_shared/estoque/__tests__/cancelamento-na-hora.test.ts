// ADR-0121, emenda 9: claim com pedido cancelado dispara o sync-venda na hora.
import { describe, expect, it, vi } from 'vitest';
import { dispararCancelamentoNaHora } from '../cancelamento-na-hora.ts';

const P = { orgId: 'org', userId: 'u', orderId: 2000000000000001, status: 'cancelled' };
const cenario = (assume: () => Promise<boolean> = () => Promise.resolve(true), publicar: () => Promise<unknown> = () => Promise.resolve({})) => {
  const a = vi.fn((_o: string, _p: string | number) => assume());
  const p = vi.fn((_j: unknown) => publicar());
  return { a, p, rodar: (over: object = {}) => dispararCancelamentoNaHora({ filaAssume: a, publicar: p }, { ...P, ...over }) };
};

describe('dispararCancelamentoNaHora', () => {
  it('cancelado com obrigação pendente na fila: publica o pedido para o sync-venda', async () => {
    const c = cenario();
    expect(await c.rodar()).toBe(true);
    expect(c.a).toHaveBeenCalledWith('org', P.orderId);
    expect(c.p).toHaveBeenCalledWith({ user_id: 'u', order_id: '2000000000000001' });
  });
  it.each(['paid', 'partially_refunded', null, undefined])('status %s: nem consulta nem publica', async (status) => {
    const c = cenario();
    expect(await c.rodar({ status })).toBe(false);
    expect(c.a).not.toHaveBeenCalled();
    expect(c.p).not.toHaveBeenCalled();
  });
  it('sem org: não publica', async () => {
    const c = cenario();
    expect(await c.rodar({ orgId: null })).toBe(false);
    expect(c.p).not.toHaveBeenCalled();
  });
  it('a fila não assume (já tratado, acervo, flag desligada): não publica', async () => {
    const c = cenario(() => Promise.resolve(false));
    expect(await c.rodar()).toBe(false);
    expect(c.p).not.toHaveBeenCalled();
  });
  it('leitura ou publicação falha: nunca lança, a fila da hora cheia cobre', async () => {
    expect(await cenario(() => Promise.reject(new Error('banco'))).rodar()).toBe(false);
    expect(await cenario(undefined, () => Promise.reject(new Error('qstash'))).rodar()).toBe(false);
  });
});
