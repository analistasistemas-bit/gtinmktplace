import { afterEach, describe, it, expect, vi } from 'vitest';
import { carregarGtinsDaVenda } from '../enriquecimento.ts';
import type { PedidoML } from '../venda.ts';

// ADR-0197 (portão da Task 3): no sync-venda, com o módulo de kit, falha de GTIN não pode deixar o código cair no
// seller_custom_field e gerar outra referência de baixa. Sem o módulo, tolerante como sempre.
const PEDIDO = { id: 1, order_items: [{ item: { id: 'MLB-CAT' }, quantity: 1 }] } as unknown as PedidoML;

describe('carregarGtinsDaVenda', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('módulo ligado e GTIN falha: incerto, mapa vazio, sem lançar', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('x', { status: 500 })));
    expect(await carregarGtinsDaVenda('t', [PEDIDO], new Set(), true)).toEqual({ gtinPorItem: new Map(), incerto: true });
  });

  it('módulo desligado: tolerante, nunca incerto', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('x', { status: 500 })));
    expect(await carregarGtinsDaVenda('t', [PEDIDO], new Set(), false)).toEqual({ gtinPorItem: new Map(), incerto: false });
  });

  it('módulo ligado e leitura boa: incerto falso', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify([
      { code: 200, body: { id: 'MLB-CAT', attributes: [{ id: 'GTIN', value_name: '7891234567895' }] } },
    ]), { status: 200 })));
    const r = await carregarGtinsDaVenda('t', [PEDIDO], new Set(), true);
    expect(r.incerto).toBe(false);
    expect(r.gtinPorItem.get('MLB-CAT')).toBe('7891234567895');
  });
});
