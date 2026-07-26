import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { montarMapaLiquido, carregarLiquidoMP, carregarLiquidoMPDoPedido } from '../enriquecimento';
import type { PagamentoMP } from '../../mercadopago/financeiro';

function pag(p: Partial<PagamentoMP> & { id: number }): PagamentoMP {
  return p as PagamentoMP;
}

describe('montarMapaLiquido', () => {
  it('inclui a venda da conta com estorno e data de liberação', () => {
    const mapa = montarMapaLiquido([
      pag({
        id: 1,
        collector_id: 123,
        transaction_amount_refunded: 10,
        money_release_date: '2026-07-30T00:00:00.000-04:00',
      }),
    ], 123);
    expect(mapa.get('1')).toEqual({
      estorno: 10,
      releaseDate: '2026-07-30T00:00:00.000-04:00',
    });
  });

  it('descarta pagamento de terceiro (collector_id != conta)', () => {
    const mapa = montarMapaLiquido([
      pag({ id: 1, collector_id: 123 }),
      pag({ id: 2, collector_id: 999 }),
    ], 123);
    expect([...mapa.keys()]).toEqual(['1']);
  });

  it('descarta a perna de frete do ML (description marketplace_shipment)', () => {
    const mapa = montarMapaLiquido([
      pag({ id: 1, collector_id: 123 }),
      pag({ id: 2, collector_id: 123, description: 'marketplace_shipment' }),
    ], 123);
    expect([...mapa.keys()]).toEqual(['1']);
  });

  // Sem conta resolvida não dá para saber o que é venda da conta. `Number(null)` é 0, então sem
  // guard um pagamento com collector_id ausente entraria como se fosse venda própria.
  it('conta inválida (0, null, undefined, NaN) → mapa vazio', () => {
    const pagamentos = [pag({ id: 1, collector_id: 123 }), pag({ id: 2, collector_id: null })];
    expect(montarMapaLiquido(pagamentos, 0).size).toBe(0);
    expect(montarMapaLiquido(pagamentos, null as unknown as number).size).toBe(0);
    expect(montarMapaLiquido(pagamentos, undefined as unknown as number).size).toBe(0);
    expect(montarMapaLiquido(pagamentos, NaN).size).toBe(0);
  });
});

/** Resposta ok de /v1/payments/{id}. */
const respOk = (p: Partial<PagamentoMP> & { id: number }) => ({ ok: true, json: async () => p });

describe('carregarLiquidoMP (varredura por período)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  // O null é o que faz sync-venda/sync-devolucao responderem 502 e o QStash re-tentar. Se virar
  // mapa vazio de novo, o worker responde 200 e o estorno fica permanentemente defasado.
  it('fetch rejeita → null (leitura falhou, não "não achei nada")', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNRESET'));
    await expect(carregarLiquidoMP('token', 123)).resolves.toBeNull();
  });

  // Conta não resolvida é condição permanente: retry não ajuda, e varrer 120 dias (até 40
  // requisições ao MP) para descartar tudo depois é desperdício puro.
  it('contaId inválido → mapa vazio sem tocar no MP', async () => {
    const mapa = await carregarLiquidoMP('token', 0);
    expect(mapa?.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('carregarLiquidoMPDoPedido', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sem payment ids → mapa vazio sem tocar no MP', async () => {
    const mapa = await carregarLiquidoMPDoPedido('token', 123, []);
    expect(mapa?.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('contaId inválido → mapa vazio sem tocar no MP', async () => {
    const mapa = await carregarLiquidoMPDoPedido('token', 0, [1]);
    expect(mapa?.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Um pagamento ilegível é leitura incompleta: com 2 pagamentos no pedido, montar o mapa só com o
  // que respondeu gravaria um estorno menor que o real. Melhor null → 502 → retry.
  it('um dos ids falha → null (mesmo que o outro tenha respondido)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(respOk({ id: 1, status: 'approved', collector_id: 123 }) as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' } as unknown as Response);
    await expect(carregarLiquidoMPDoPedido('token', 123, [1, 2])).resolves.toBeNull();
  });

  it('caminho feliz: 1 requisição por id e o mesmo mapa da varredura', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const id = Number(String(url).split('/').pop());
      return Promise.resolve(respOk({
        id, status: 'approved', collector_id: 123,
        transaction_amount_refunded: id === 1 ? 10 : 0,
        money_release_date: '2026-07-30T00:00:00.000-04:00',
      }) as unknown as Response);
    });
    const mapa = await carregarLiquidoMPDoPedido('token', 123, [1, '2']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://api.mercadopago.com/v1/payments/1');
    expect(mapa?.get('1')).toEqual({ estorno: 10, releaseDate: '2026-07-30T00:00:00.000-04:00' });
    expect(mapa?.get('2')).toEqual({ estorno: 0, releaseDate: '2026-07-30T00:00:00.000-04:00' });
  });

  // Os mesmos filtros da varredura: collector alheio e perna de frete (montarMapaLiquido), e
  // status != approved (que na varredura vem do parâmetro status=approved da busca).
  it('descarta terceiro, perna de frete e pagamento não aprovado', async () => {
    const porId: Record<string, Partial<PagamentoMP> & { id: number }> = {
      '1': { id: 1, status: 'approved', collector_id: 123 },
      '2': { id: 2, status: 'approved', collector_id: 999 },
      '3': { id: 3, status: 'approved', collector_id: 123, description: 'marketplace_shipment' },
      '4': { id: 4, status: 'rejected', collector_id: 123 },
    };
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(respOk(porId[String(url).split('/').pop() as string]) as unknown as Response));
    const mapa = await carregarLiquidoMPDoPedido('token', 123, [1, 2, 3, 4]);
    expect([...(mapa?.keys() ?? [])]).toEqual(['1']);
  });
});
