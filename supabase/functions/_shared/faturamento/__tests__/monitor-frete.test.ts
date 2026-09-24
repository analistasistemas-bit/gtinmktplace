import { describe, expect, it, vi } from 'vitest';
import { avaliarAltaFrete, verificarAltaFrete, type CtxAltaFrete, type DepsAltaFrete } from '../monitor-frete.ts';
import { montarMensagemAltaFrete } from '../../notificacoes/telegram.ts';

describe('avaliarAltaFrete', () => {
  it('alta real (+62%, +R$9,50): dispara', () => {
    expect(avaliarAltaFrete(24.9, 15.4)).toEqual({ diferenca: 9.5, pct: 62 });
  });
  it('exatamente +10% não dispara (precisa ser maior)', () => {
    expect(avaliarAltaFrete(22, 20)).toBeNull();
  });
  it('+10,05% e +R$2,01: dispara', () => {
    expect(avaliarAltaFrete(22.01, 20)).toEqual({ diferenca: 2.01, pct: 10 });
  });
  it('acima de 10% mas menos de R$2: não dispara', () => {
    expect(avaliarAltaFrete(11.99, 10)).toBeNull();
  });
  it('R$2 mas menos de 10%: não dispara', () => {
    expect(avaliarAltaFrete(32, 30)).toBeNull();
  });
  it('queda não dispara', () => {
    expect(avaliarAltaFrete(10, 20)).toBeNull();
  });
  it.each([
    [null, 10], [10, null], [0, 10], [10, 0], [-1, 10],
  ])('frete %s vs %s (nulo/zero/negativo): não compara', (atual, anterior) => {
    expect(avaliarAltaFrete(atual as number | null, anterior as number | null)).toBeNull();
  });
});

describe('montarMensagemAltaFrete', () => {
  it('traz título, MLB, os dois valores e o %', () => {
    const msg = montarMensagemAltaFrete({ titulo: 'Shampoo X', mlItemId: 'MLB123', atual: 24.9, anterior: 15.4, pct: 62 });
    expect(msg).toContain('Frete subiu');
    expect(msg).toContain('Shampoo X');
    expect(msg).toContain('MLB123');
    expect(msg).toContain('24,90');
    expect(msg).toContain('15,40');
    expect(msg).toContain('+62%');
  });
  it('sem título usa o MLB', () => {
    expect(montarMensagemAltaFrete({ titulo: null, mlItemId: 'MLB9', atual: 30, anterior: 20, pct: 50 })).toContain('MLB9');
  });
});

const AGORA = Date.parse('2026-09-24T12:00:00.000Z');
const base = (over: Partial<CtxAltaFrete> = {}): CtxAltaFrete => ({
  orgId: 'org1', userId: 'u1', orderId: 555, packId: null, status: 'paid',
  freteVendedor: 24.9, dataVenda: '2026-09-24T10:00:00.000Z',
  itens: [{ ml_item_id: 'MLB1', variation_id: 7, quantity: 1, titulo: 'Shampoo X' }],
  agoraMs: AGORA, ...over,
});
const deps = (over: Partial<DepsAltaFrete> = {}): DepsAltaFrete => ({
  monitorAtivo: vi.fn().mockResolvedValue(true),
  buscarVendaAnterior: vi.fn().mockResolvedValue({ order_id: 444, frete_vendedor: 15.4 }),
  reservar: vi.fn().mockResolvedValue(true),
  notificar: vi.fn().mockResolvedValue(1),
  ...over,
});

describe('verificarAltaFrete', () => {
  it('caso feliz: busca a anterior do mesmo item+variação e notifica 1x', async () => {
    const d = deps();
    expect(await verificarAltaFrete(base(), d)).toBe(true);
    expect(d.buscarVendaAnterior).toHaveBeenCalledWith({
      orgId: 'org1', mlItemId: 'MLB1', variationId: 7, antesDe: '2026-09-24T10:00:00.000Z', orderId: 555,
    });
    expect(d.reservar).toHaveBeenCalledWith('org1', 'u1', '555');
    expect(d.notificar).toHaveBeenCalledTimes(1);
    expect((d.notificar as ReturnType<typeof vi.fn>).mock.calls[0][1]).toContain('+62%');
  });

  it('monitor desligado: não busca nem notifica', async () => {
    const d = deps({ monitorAtivo: vi.fn().mockResolvedValue(false) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.buscarVendaAnterior).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it.each([
    ['2 itens', { itens: [
      { ml_item_id: 'MLB1', variation_id: 7, quantity: 1, titulo: 'a' },
      { ml_item_id: 'MLB2', variation_id: null, quantity: 1, titulo: 'b' },
    ] }],
    ['quantity 2', { itens: [{ ml_item_id: 'MLB1', variation_id: 7, quantity: 2, titulo: 'a' }] }],
    ['sem ml_item_id', { itens: [{ ml_item_id: null, variation_id: null, quantity: 1, titulo: 'a' }] }],
    ['frete nulo', { freteVendedor: null }],
    ['frete zero', { freteVendedor: 0 }],
    ['venda com mais de 3 dias', { dataVenda: '2026-09-20T11:59:00.000Z' }],
    ['sem data', { dataVenda: null }],
    ['pedido cancelado', { status: 'cancelled' }],
    ['pedido em pack (frete é do envio)', { packId: 2000001 }],
  ])('%s: não avisa e não consulta o toggle', async (_nome, over) => {
    const d = deps();
    expect(await verificarAltaFrete(base(over as Partial<CtxAltaFrete>), d)).toBe(false);
    expect(d.monitorAtivo).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('sem venda anterior: não avisa', async () => {
    const d = deps({ buscarVendaAnterior: vi.fn().mockResolvedValue(null) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('alta abaixo do gatilho: não reserva nem avisa', async () => {
    const d = deps({ buscarVendaAnterior: vi.fn().mockResolvedValue({ order_id: 444, frete_vendedor: 24 }) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.reservar).not.toHaveBeenCalled();
  });

  it('reserva já tomada (webhook repetido): não avisa de novo', async () => {
    const d = deps({ reservar: vi.fn().mockResolvedValue(false) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('prazo estourado antes da reserva: não reserva nem avisa', async () => {
    const d = deps();
    const r = await verificarAltaFrete(base({ limiteMs: 1000, relogio: () => 1001 }), d);
    expect(r).toBe(false);
    expect(d.reservar).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('dentro do prazo: segue normal', async () => {
    const d = deps();
    expect(await verificarAltaFrete(base({ limiteMs: 1000, relogio: () => 999 }), d)).toBe(true);
  });

  it('variação nula é repassada como null', async () => {
    const d = deps();
    await verificarAltaFrete(base({ itens: [{ ml_item_id: 'MLB1', variation_id: null, quantity: 1, titulo: 'x' }] }), d);
    expect(d.buscarVendaAnterior).toHaveBeenCalledWith(expect.objectContaining({ variationId: null }));
  });
});
