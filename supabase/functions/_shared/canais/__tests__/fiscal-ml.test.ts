import { afterEach, describe, expect, it } from 'vitest';
import {
  empurrarFiscalSku, lerCanInvoice, montarFiscalInformation, vincularSkuAnuncio,
} from '../fiscal-ml.ts';

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

function fakeFetch(respostas: Array<{ status: number; body?: unknown }>) {
  let i = 0;
  return (async () => {
    const r = respostas[Math.min(i, respostas.length - 1)];
    i++;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
}

describe('montarFiscalInformation (payload puro)', () => {
  it('converte peso de gramas para kg e omite cest/fci quando ausentes', () => {
    const p = montarFiscalInformation(
      { nome_pai: 'X', unidade: 'un', ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102' },
      { codigo: '00101', gtin: '789', peso_gramas: 200, ml_variation_id: null },
      { origin_type: 'reseller' },
    );
    expect(p.gross_weight).toBe(0.2);
    expect(p.measurement_unit).toBe('UN');
    expect(p).not.toHaveProperty('cest');
    const tax = p.tax_information as Record<string, unknown>;
    expect(tax).not.toHaveProperty('fci');
    expect(tax.ean).toBe('789');
  });

  it('inclui cest/fci quando presentes', () => {
    const p = montarFiscalInformation(
      { nome_pai: 'X', unidade: 'UN', ncm: '39269090', cest: '0100100', origem_nfe: 3, fci: 'ABC123', ex_tipi: '01', tributacao_icms: '500' },
      { codigo: '00101', gtin: null, peso_gramas: null, ml_variation_id: null },
      { origin_type: 'reseller' },
    );
    expect(p).not.toHaveProperty('gross_weight');
    const tax = p.tax_information as Record<string, unknown>;
    expect(tax.cest).toBe('0100100');
    expect(tax.fci).toBe('ABC123');
    expect(tax.ex_tipi).toBe('01');
  });
});

describe('empurrarFiscalSku (upsert POST→409→PUT)', () => {
  it('POST 201: não chama PUT', async () => {
    globalThis.fetch = fakeFetch([{ status: 201 }]);
    await expect(empurrarFiscalSku('tok', { sku: '00101' })).resolves.toBeUndefined();
  });

  it('POST 409 → PUT 200: sucesso', async () => {
    globalThis.fetch = fakeFetch([{ status: 409 }, { status: 200 }]);
    await expect(empurrarFiscalSku('tok', { sku: '00101' })).resolves.toBeUndefined();
  });

  it('POST 409 → PUT 4xx: lança Error com .status do PUT (definitivo)', async () => {
    globalThis.fetch = fakeFetch([{ status: 409 }, { status: 400, body: 'sku inválido' }]);
    await expect(empurrarFiscalSku('tok', { sku: '00101' })).rejects.toMatchObject({ status: 400 });
  });

  it('POST 500: lança Error com .status 500 (transitório)', async () => {
    globalThis.fetch = fakeFetch([{ status: 500, body: 'gateway' }]);
    await expect(empurrarFiscalSku('tok', { sku: '00101' })).rejects.toMatchObject({ status: 500 });
  });
});

describe('vincularSkuAnuncio', () => {
  it('409 (vínculo já existe) é sucesso idempotente', async () => {
    globalThis.fetch = fakeFetch([{ status: 409 }]);
    await expect(vincularSkuAnuncio('tok', { sku: '00101', item_id: 'MLB1' })).resolves.toBeUndefined();
  });

  it('4xx real lança Error com .status', async () => {
    globalThis.fetch = fakeFetch([{ status: 400, body: 'bad' }]);
    await expect(vincularSkuAnuncio('tok', { sku: '00101', item_id: 'MLB1' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('lerCanInvoice', () => {
  it('status true → pronto sem causa', async () => {
    globalThis.fetch = fakeFetch([{ status: 200, body: { status: true } }]);
    await expect(lerCanInvoice('tok', 'MLB1')).resolves.toEqual({ pronto: true, causa: null });
  });

  it('status false → não pronto com causa preenchida', async () => {
    globalThis.fetch = fakeFetch([{ status: 200, body: { status: false, reason: 'X' } }]);
    const r = await lerCanInvoice('tok', 'MLB1');
    expect(r?.pronto).toBe(false);
    expect(r?.causa).toContain('reason');
  });

  it('resposta não-ok devolve null (sem lançar)', async () => {
    globalThis.fetch = fakeFetch([{ status: 500 }]);
    await expect(lerCanInvoice('tok', 'MLB1')).resolves.toBeNull();
  });
});
