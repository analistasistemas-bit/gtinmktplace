import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Tarifa } from '../../promocoes/tipos.ts';
import { comDiagnostico, motivoDaFalha } from '../diagnostico-tarifa.ts';

class TarifaEstimada extends Error {}
const T: Tarifa = { comissao: { percentual: 12, fixa: 6 }, frete: 1 };
const Q = { preco: 50, categoria: 'MLB1', listingType: 'gold_special', dim: null } as never;

describe('motivoDaFalha', () => {
  it.each([
    [new Error('listing_prices gold_special 429: {"message":"local_rate_limited","x":"corpo do ML"}'), { componente: 'comissao', classe: 'Error', status: 429 }],
    [new TarifaEstimada('o Mercado Livre respondeu sem `sale_fee_details` — a comissão não veio detalhada'), { componente: 'comissao', classe: 'TarifaEstimada', status: null }],
    [new TarifaEstimada('o Mercado Livre recusou o cálculo de frete (HTTP 429)'), { componente: 'frete', classe: 'TarifaEstimada', status: 429 }],
    [new TarifaEstimada('o Mercado Livre não respondeu o frete (error sending request for url (https://api.mercadolibre.com/users/123/x))'), { componente: 'frete', classe: 'TarifaEstimada', status: null }],
    [new TypeError('error sending request for url (https://api.mercadolibre.com/sites/MLB/listing_prices?x=1)'), { componente: 'outro', classe: 'TypeError', status: null }],
    ['texto solto', { componente: 'outro', classe: 'outra', status: null }],
    [null, { componente: 'outro', classe: 'outra', status: null }],
  ])('%#: só códigos fixos', (e, esperado) => {
    expect(motivoDaFalha(e)).toEqual(esperado);
  });

  it('classe desconhecida não sai com o nome dela', () => {
    class SegredoNoNome extends Error {}
    expect(motivoDaFalha(new SegredoNoNome('x'))).toEqual({ componente: 'outro', classe: 'outra', status: null });
  });
});

describe('comDiagnostico', () => {
  it('sucesso passa intacto, sem log', async () => {
    const log = vi.fn();
    expect(await comDiagnostico(async () => T, log)(Q)).toBe(T);
    expect(log).not.toHaveBeenCalled();
  });

  it('falha: loga só os códigos, uma vez, e relança o MESMO erro; consulta uma vez', async () => {
    const erro = new Error('listing_prices gold_special 429: corpo com SEGREDO_FALSO e https://x');
    const tarifa = vi.fn(async () => { throw erro; });
    const log = vi.fn();
    await expect(comDiagnostico(tarifa, log)(Q)).rejects.toBe(erro);
    expect(tarifa).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([['[agentes] tarifa indisponível', { componente: 'comissao', classe: 'Error', status: 429 }]]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SEGREDO_FALSO|http|gold_special/);
  });

  it('log que lança não troca o erro', async () => {
    const erro = new Error('x');
    await expect(comDiagnostico(async () => { throw erro; }, () => { throw new Error('log'); })(Q)).rejects.toBe(erro);
  });

  it('a edge embrulha a tarifa', () => {
    expect(readFileSync('supabase/functions/agentes/index.ts', 'utf8')).toContain('tarifaEm: comDiagnostico(criarTarifaEm(');
  });
});
