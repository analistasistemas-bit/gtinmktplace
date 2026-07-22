import { describe, it, expect, vi, afterEach } from 'vitest';
import { agregarFinanceiro, montarInfoPorPagamento, escolherTokenMP, resolverTokenMP, type PagamentoMP } from '../financeiro';

describe('resolverTokenMP (integração: RPC do Vault + gate por env)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const AVIL = 'a72ea303-5559-4a35-9aff-daa12cd1de12';
  const DSA = 'a1fcd536-bb43-4fae-9f44-1e09d19e6c8e';
  const stubEnv = (env: Record<string, string>) =>
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
  const admin = (vaultToken: string | null) => ({ rpc: async () => ({ data: vaultToken }) }) as any;

  it('org com secret no Vault → usa o secret (ignora o global)', async () => {
    stubEnv({ MP_FALLBACK_ORG_ID: AVIL, MP_ACCESS_TOKEN: 'global' });
    expect(await resolverTokenMP(admin('vault-dsa'), DSA)).toBe('vault-dsa');
  });
  it('org de fallback (Avil) sem secret → usa o global', async () => {
    stubEnv({ MP_FALLBACK_ORG_ID: AVIL, MP_ACCESS_TOKEN: 'global' });
    expect(await resolverTokenMP(admin(null), AVIL)).toBe('global');
  });
  it('OUTRA org (DSA) sem secret → null, NUNCA o global (regressão cross-tenant)', async () => {
    stubEnv({ MP_FALLBACK_ORG_ID: AVIL, MP_ACCESS_TOKEN: 'global' });
    expect(await resolverTokenMP(admin(null), DSA)).toBeNull();
  });
});

describe('escolherTokenMP (fallback global restrito à org da Avil)', () => {
  const AVIL = 'a72ea303-5559-4a35-9aff-daa12cd1de12';
  const OUTRA = '00000000-0000-0000-0000-000000000999';

  it('secret da org (Vault) sempre vence', () => {
    expect(escolherTokenMP('tok-vault', OUTRA, AVIL, 'tok-global')).toBe('tok-vault');
  });
  it('org de fallback sem secret → usa o token global', () => {
    expect(escolherTokenMP(null, AVIL, AVIL, 'tok-global')).toBe('tok-global');
  });
  it('OUTRA org sem secret → null (NUNCA o token global — evita cross-tenant)', () => {
    expect(escolherTokenMP(null, OUTRA, AVIL, 'tok-global')).toBeNull();
  });
  it('sem MP_FALLBACK_ORG_ID configurado → ninguém usa o global', () => {
    expect(escolherTokenMP(null, AVIL, undefined, 'tok-global')).toBeNull();
  });
  it('org de fallback mas sem token global → null', () => {
    expect(escolherTokenMP(null, AVIL, AVIL, undefined)).toBeNull();
  });
});

function pag(p: Partial<PagamentoMP> & { id: number }): PagamentoMP {
  return p as PagamentoMP;
}

const CONTA = 1003820507;
const INTERVALO = { desde: '2026-06-01T00:00:00.000Z', ate: '2026-06-30T23:59:59.000Z', contaId: CONTA };

describe('agregarFinanceiro — só vendas da conta (collector_id)', () => {
  it('exclui pagamentos em que a conta NÃO é a recebedora (compras/terceiros)', () => {
    const pagamentos = [
      // venda real (conta é collector)
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 33, transaction_details: { net_received_amount: 16.1 } }),
      // compra/terceiro: collector é outro → NÃO entra
      pag({ id: 2, collector_id: 999999, date_approved: '2026-06-18T09:00:00.000Z',
        transaction_amount: 3999.9, transaction_details: { net_received_amount: 3773.67 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(33);
    expect(r.liquido).toBe(16.1);
    expect(r.pagamentos).toBe(1);
  });

  it('exclui o pagamento de frete (marketplace_shipment) — não é venda', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'Fita Cetim', transaction_amount: 12.65,
        transaction_details: { net_received_amount: 10.5 } }),
      // frete da mesma venda → fora
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'marketplace_shipment', transaction_amount: 8.99,
        transaction_details: { net_received_amount: 8.99 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(12.65);
    expect(r.liquido).toBe(10.5);
    expect(r.pagamentos).toBe(1);
  });

  it('soma bruto/líquido/estornos das vendas da conta e calcula descontos', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 12.65, transaction_amount_refunded: 0,
        transaction_details: { net_received_amount: 4.35 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-20T09:00:00.000Z',
        transaction_amount: 25, transaction_amount_refunded: 0,
        transaction_details: { net_received_amount: 10.7 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(37.65);
    expect(r.liquido).toBe(15.05);
    expect(r.descontos).toBe(22.6);
    expect(r.estornos).toBe(0);
    expect(r.pagamentos).toBe(2);
  });

  it('devolve a lista de vendas (uma por pagamento) com bruto/líquido/retido/estorno', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'Fita Cetim', transaction_amount: 12.65, transaction_amount_refunded: 0,
        transaction_details: { net_received_amount: 4.35 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-20T09:00:00.000Z',
        description: 'Linha 120m', transaction_amount: 25, transaction_amount_refunded: 5,
        transaction_details: { net_received_amount: 10.7 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.vendas).toHaveLength(2);
    // ordenado por data desc — a venda mais recente vem primeiro
    expect(r.vendas[0]).toEqual({
      id: '2', data: '2026-06-20T09:00:00.000Z', dataLiberacao: null, descricao: 'Linha 120m',
      bruto: 25, liquido: 10.7, retido: 14.3, estorno: 5, custo: null, codigo: null,
    });
    expect(r.vendas[1]).toEqual({
      id: '1', data: '2026-06-17T09:00:00.000Z', dataLiberacao: null, descricao: 'Fita Cetim',
      bruto: 12.65, liquido: 4.35, retido: 8.3, estorno: 0, custo: null, codigo: null,
    });
  });

  it('anexa custo + código por pagamento quando fornecido (markup), null quando ausente', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 25, transaction_details: { net_received_amount: 18 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-18T09:00:00.000Z',
        transaction_amount: 30, transaction_details: { net_received_amount: 20 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO, { '1': { custo: 9.9, codigo: '00220566' } });
    const v1 = r.vendas.find((v) => v.id === '1');
    const v2 = r.vendas.find((v) => v.id === '2');
    expect(v1?.custo).toBe(9.9);
    expect(v1?.codigo).toBe('00220566');
    expect(v2?.custo).toBeNull();
    expect(v2?.codigo).toBeNull();
  });

  it('expõe a data de liberação (money_release_date) por venda; null quando o MP não informa', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        money_release_date: '2026-07-01T09:00:00.000Z',
        transaction_amount: 33, transaction_details: { net_received_amount: 16.1 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-18T09:00:00.000Z',
        transaction_amount: 25, transaction_details: { net_received_amount: 10.7 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.vendas.find((v) => v.id === '1')?.dataLiberacao).toBe('2026-07-01T09:00:00.000Z');
    expect(r.vendas.find((v) => v.id === '2')?.dataLiberacao).toBeNull();
  });

  it('não inclui frete nem compras de terceiros na lista de vendas', () => {
    const r = agregarFinanceiro([
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 33, transaction_details: { net_received_amount: 16.1 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'marketplace_shipment', transaction_amount: 8.99,
        transaction_details: { net_received_amount: 8.99 } }),
      pag({ id: 3, collector_id: 999, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 999, transaction_details: { net_received_amount: 900 } }),
    ], INTERVALO);
    expect(r.vendas.map((v) => v.id)).toEqual(['1']);
  });

  it('compara collector_id como número mesmo vindo string', () => {
    const r = agregarFinanceiro(
      [pag({ id: 1, collector_id: String(CONTA), date_approved: '2026-06-10T00:00:00.000Z',
        transaction_amount: 50, transaction_details: { net_received_amount: 40 } })],
      INTERVALO,
    );
    expect(r.pagamentos).toBe(1);
    expect(r.bruto).toBe(50);
  });

  it('ignora vendas da conta fora do intervalo (por date_approved)', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-10T00:00:00.000Z',
        transaction_amount: 50, transaction_details: { net_received_amount: 40 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-05-10T00:00:00.000Z',
        transaction_amount: 999, transaction_details: { net_received_amount: 900 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(50);
    expect(r.pagamentos).toBe(1);
  });

  it('retorna zeros quando não há vendas da conta', () => {
    const r = agregarFinanceiro(
      [pag({ id: 1, collector_id: 42, date_approved: '2026-06-10T00:00:00.000Z',
        transaction_amount: 100, transaction_details: { net_received_amount: 90 } })],
      INTERVALO,
    );
    expect(r).toEqual({ bruto: 0, liquido: 0, descontos: 0, estornos: 0, pagamentos: 0, vendas: [] });
  });
});

describe('montarInfoPorPagamento', () => {
  it('usa custo+código da variação (R$ × qtd) quando há variação', () => {
    const r = montarInfoPorPagamento(
      { '111': { mlItemId: 'MLB1', mlVariationId: 'V1', quantidade: 2 } },
      { V1: { custo: 0.77896, codigo: '00111' } },
      { MLB1: { custo: 9.99, codigo: '00999' } },
    );
    expect(r).toEqual({ '111': { custo: 1.56, codigo: '00111' } });
  });

  it('cai no custo+código por item quando a venda não tem variação', () => {
    const r = montarInfoPorPagamento(
      { '222': { mlItemId: 'MLB2', mlVariationId: null, quantidade: 3 } },
      {},
      { MLB2: { custo: 1.5, codigo: '00222' } },
    );
    expect(r).toEqual({ '222': { custo: 4.5, codigo: '00222' } });
  });

  it('ignora pagamento sem custo (variação e item ausentes, zero ou negativo)', () => {
    const r = montarInfoPorPagamento(
      {
        '1': { mlItemId: 'SEM', mlVariationId: 'X', quantidade: 1 },
        '2': { mlItemId: 'ZERO', mlVariationId: null, quantidade: 3 },
        '3': { mlItemId: 'NEG', mlVariationId: null, quantidade: 1 },
      },
      {},
      { ZERO: { custo: 0, codigo: 'z' }, NEG: { custo: -10, codigo: 'n' } },
    );
    expect(r).toEqual({});
  });
});

describe('agregarFinanceiro — rateio de frete em pedido pack', () => {
  it('rateia o frete por peso quando duas vendas compartilham shipping_id (zero-soma)', () => {
    // Pack real: Linha 45,10 (frete concentrado no líquido dela) + Fita 12,70. Σ líq = 35,00.
    const pagamentos = [
      pag({ id: 10, collector_id: CONTA, date_approved: '2026-06-15T10:00:00.000Z',
        transaction_amount: 45.10, transaction_details: { net_received_amount: 24.46 } }),
      pag({ id: 11, collector_id: CONTA, date_approved: '2026-06-15T10:00:00.000Z',
        transaction_amount: 12.70, transaction_details: { net_received_amount: 10.54 } }),
    ];
    const info = {
      '10': { custo: 21.16, codigo: '02543842', tarifa: 7.44, peso: 338, shippingId: 'S1' },
      '11': { custo: 1.95, codigo: 'FITA', tarifa: 2.16, peso: 58, shippingId: 'S1' },
    };
    const r = agregarFinanceiro(pagamentos, INTERVALO, info);
    const byId = Object.fromEntries(r.vendas.map((v) => [v.id, v]));
    expect(byId['10'].liquido).toBe(26.39);
    expect(byId['10'].retido).toBe(18.71);
    expect(byId['11'].liquido).toBe(8.61);
    expect(byId['11'].retido).toBe(4.09);
    // Totais do período inalterados (rateio é zero-soma).
    expect(r.liquido).toBe(35.00);
    expect(r.bruto).toBe(57.80);
  });
});
