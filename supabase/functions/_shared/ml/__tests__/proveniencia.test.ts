import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarFreteVendedor, buscarFreteVendedorComProveniencia } from '../frete';
import { comissaoDe, comissaoDeComProveniencia } from '../listing-prices';
import { montarTarifa, montarTarifaComProveniencia } from '../tarifa';

// ADR-0148 D-2/D-3 (implementa a D-28 da ADR-0141). Hoje comissão e frete convertem falha em ZERO,
// e o zero de "o comprador paga" é indistinguível do zero de "o ML caiu". A DRE precisa dessa
// distinção para recusar em vez de exibir lucro inflado.
//
// ATENÇÃO: aqui se fala EXCLUSIVAMENTE do `buscarFreteVendedor` de `_shared/ml/frete.ts`, que
// devolve 0 em falha. Existe um homônimo em `_shared/faturamento/io.ts:193` com contrato oposto
// (devolve `number | null`). São funções diferentes.

const DIM = { altura_cm: 20, largura_cm: 15, comprimento_cm: 10, peso_gramas: 800 };

function mockFetch(resposta: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, status, json: async () => resposta, text: async () => JSON.stringify(resposta),
  } as unknown as Response);
}

afterEach(() => vi.restoreAllMocks());

describe('buscarFreteVendedorComProveniencia (_shared/ml/frete.ts)', () => {
  it('vendedor paga, com as dimensões do operador: official', async () => {
    mockFetch({ coverage: { all_country: { list_cost: 12.35, discount: { type: 'mandatory' } } } });
    const r = await buscarFreteVendedorComProveniencia('t', '1', 89.9, 'MLB1', DIM);
    expect(r).toEqual({ valor: 12.35, proveniencia: 'official' });
  });

  // Critério de aceite 2: este zero é RESPOSTA, não ausência — e por isso não bloqueia a DRE.
  it('comprador paga: zero legítimo, e ainda assim official', async () => {
    mockFetch({ coverage: { all_country: { list_cost: 5.65, discount: { type: 'none' } } } });
    const r = await buscarFreteVendedorComProveniencia('t', '1', 40, 'MLB1', DIM);
    expect(r.valor).toBe(0);
    expect(r.proveniencia).toBe('official');
  });

  // Critério de aceite 3.
  it('sem dimensões: usa o pacote default e marca partial, dizendo o motivo', async () => {
    mockFetch({ coverage: { all_country: { list_cost: 12.35, discount: { type: 'mandatory' } } } });
    const r = await buscarFreteVendedorComProveniencia('t', '1', 89.9, 'MLB1', null);
    expect(r.proveniencia).toBe('partial');
    expect(r.motivo).toMatch(/dimens/i);
  });

  it('dimensões inválidas contam como ausentes', async () => {
    mockFetch({ coverage: { all_country: { list_cost: 12.35, discount: { type: 'mandatory' } } } });
    const r = await buscarFreteVendedorComProveniencia('t', '1', 89.9, 'MLB1', { ...DIM, peso_gramas: 0 });
    expect(r.proveniencia).toBe('partial');
  });

  // Critério de aceite 4: fault injection.
  it.each([400, 401, 429, 500])('HTTP %i: estimated, nunca zero silencioso', async (status) => {
    mockFetch({}, false, status);
    const r = await buscarFreteVendedorComProveniencia('t', '1', 89.9, 'MLB1', DIM);
    expect(r.proveniencia).toBe('estimated');
    expect(r.motivo).toContain(String(status));
  });

  it('timeout / rede caída: estimated', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network timeout'));
    const r = await buscarFreteVendedorComProveniencia('t', '1', 89.9, 'MLB1', DIM);
    expect(r.proveniencia).toBe('estimated');
  });

  it('resposta 200 sem coverage (me2=false): estimated, não zero', async () => {
    mockFetch({ coverage: {} });
    const r = await buscarFreteVendedorComProveniencia('t', '1', 89.9, 'MLB1', DIM);
    expect(r.proveniencia).toBe('estimated');
    expect(r.valor).toBe(0);
  });

  it('vendedor paga mas list_cost ausente: estimated, não zero', async () => {
    mockFetch({ coverage: { all_country: { free_shipping_by_meli: true } } });
    const r = await buscarFreteVendedorComProveniencia('t', '1', 89.9, 'MLB1', DIM);
    expect(r.proveniencia).toBe('estimated');
  });

  // Critério de aceite 1: o wrapper preserva o contrato que a publicação depende.
  it('o helper antigo continua devolvendo número puro, e 0 em falha', async () => {
    mockFetch({}, false, 500);
    await expect(buscarFreteVendedor('t', '1', 89.9, 'MLB1', DIM)).resolves.toBe(0);
    vi.restoreAllMocks();
    mockFetch({ coverage: { all_country: { list_cost: 12.35, discount: { type: 'mandatory' } } } });
    await expect(buscarFreteVendedor('t', '1', 89.9, 'MLB1', DIM)).resolves.toBe(12.35);
  });
});

describe('comissaoDeComProveniencia (_shared/ml/listing-prices.ts)', () => {
  it('schema completo: official', () => {
    const r = comissaoDeComProveniencia({ sale_fee_amount: 12.59, sale_fee_details: { percentage_fee: 14, fixed_fee: 0 } });
    expect(r).toEqual({ valor: { percentual: 14, fixa: 0 }, proveniencia: 'official' });
  });

  it('sem sale_fee_details: estimated, não zero', () => {
    const r = comissaoDeComProveniencia({ sale_fee_amount: 12.59 });
    expect(r.proveniencia).toBe('estimated');
    expect(r.motivo).toMatch(/sale_fee_details/);
  });

  it('percentual zero explícito continua official — zero é resposta', () => {
    const r = comissaoDeComProveniencia({ sale_fee_amount: 0, sale_fee_details: { percentage_fee: 0, fixed_fee: 0 } });
    expect(r.proveniencia).toBe('official');
  });

  it('o helper antigo continua colapsando para zero', () => {
    expect(comissaoDe({ sale_fee_amount: 12.59 })).toEqual({ percentual: 0, fixa: 0 });
  });
});

describe('montarTarifaComProveniencia (_shared/ml/tarifa.ts)', () => {
  const lpOk = { sale_fee_amount: 12.59, sale_fee_details: { percentage_fee: 14, fixed_fee: 0 } };

  it('duas modalidades completas e frete official: official', () => {
    const r = montarTarifaComProveniencia(89.9, lpOk, lpOk, { valor: 8.45, proveniencia: 'official' });
    expect(r.proveniencia).toBe('official');
    expect(r.valor.classico.comissao).toBe(12.59);
    expect(r.valor.frete).toBe(8.45);
  });

  // Critério de aceite 4: schema sem sale_fee_amount.
  it('sem sale_fee_amount: estimated', () => {
    const r = montarTarifaComProveniencia(89.9, { sale_fee_details: { percentage_fee: 14, fixed_fee: 0 } } as never, lpOk, { valor: 8.45, proveniencia: 'official' });
    expect(r.proveniencia).toBe('estimated');
    expect(r.motivo).toMatch(/sale_fee_amount/);
  });

  it('a proveniência pior vence: frete partial rebaixa o conjunto', () => {
    const r = montarTarifaComProveniencia(89.9, lpOk, lpOk, { valor: 8.45, proveniencia: 'partial', motivo: 'sem dimensões' });
    expect(r.proveniencia).toBe('partial');
    expect(r.motivo).toBe('sem dimensões');
  });

  it('frete estimated rebaixa mesmo com comissão completa', () => {
    const r = montarTarifaComProveniencia(89.9, lpOk, lpOk, { valor: 0, proveniencia: 'estimated', motivo: 'HTTP 500' });
    expect(r.proveniencia).toBe('estimated');
  });

  it('o helper antigo continua com a mesma saída', () => {
    expect(montarTarifa(89.9, lpOk, lpOk, 8.45).classico.recebe).toBe(68.86);
  });
});
