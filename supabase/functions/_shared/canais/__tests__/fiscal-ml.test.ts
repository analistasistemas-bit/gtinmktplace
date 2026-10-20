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
      { nome_pai: 'X', unidade: 'un', ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102', descricao_fiscal: null },
      { codigo: '00101', gtin: '7891000315507', peso_gramas: 200, ml_variation_id: null },
      { origin_type: 'reseller' },
    );
    // M2 (auditoria fiscal 19/10): peso bruto (kg) vive dentro de tax_information, nunca na raiz.
    expect(p).not.toHaveProperty('gross_weight');
    expect(p.measurement_unit).toBe('UN');
    expect(p).not.toHaveProperty('cest');
    const tax = p.tax_information as Record<string, unknown>;
    expect(tax.gross_weight).toBe(0.2);
    expect(tax).not.toHaveProperty('fci');
    expect(tax.ean).toBe('7891000315507');
  });

  it('sem peso_gramas não envia gross_weight em lugar nenhum (M2)', () => {
    const p = montarFiscalInformation(
      { nome_pai: 'X', unidade: 'un', ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102', descricao_fiscal: null },
      { codigo: '00101', gtin: null, peso_gramas: null, ml_variation_id: null },
      { origin_type: 'reseller' },
    );
    expect(p).not.toHaveProperty('gross_weight');
    expect(p.tax_information).not.toHaveProperty('gross_weight');
  });

  // A5 (auditoria fiscal 19/10): código interno/GTIN inválido nunca vai como EAN fiscal.
  it.each([
    ['ABC7891000315507'], ['7891-000315507'], ['3000123'], ['3000123456781'], ['7891234567890'], ['123'],
  ])('gtin %s → sem ean', (gtin) => {
    const p = montarFiscalInformation(
      { nome_pai: 'X', unidade: 'UN', ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102', descricao_fiscal: null },
      { codigo: '00101', gtin, peso_gramas: 200, ml_variation_id: null },
      { origin_type: 'reseller' },
    );
    expect(p.tax_information as Record<string, unknown>).not.toHaveProperty('ean');
  });

  it('inclui cest/fci quando presentes', () => {
    const p = montarFiscalInformation(
      { nome_pai: 'X', unidade: 'UN', ncm: '39269090', cest: '0100100', origem_nfe: 3, fci: 'ABC123', ex_tipi: '01', tributacao_icms: '500', descricao_fiscal: null },
      { codigo: '00101', gtin: null, peso_gramas: null, ml_variation_id: null },
      { origin_type: 'reseller' },
    );
    expect(p).not.toHaveProperty('gross_weight');
    const tax = p.tax_information as Record<string, unknown>;
    expect(tax.cest).toBe('0100100');
    expect(tax.fci).toBe('ABC123');
    expect(tax.ex_tipi).toBe('01');
  });

  // ML recusou em produção (Zaven, 17/10): 400 "tax_information.origin_type is required".
  it('origin_type vai dentro de tax_information', () => {
    const p = montarFiscalInformation(
      { nome_pai: 'X', unidade: 'UN', ncm: '62034900', cest: null, origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102', descricao_fiscal: null },
      { codigo: 'S1', gtin: null, peso_gramas: null, ml_variation_id: null },
      { origin_type: 'reseller' },
    );
    expect((p.tax_information as Record<string, unknown>).origin_type).toBe('reseller');
  });

  it('title usa descrição fiscal; nula ou vazia cai no nome_pai', () => {
    const base = { nome_pai: 'Short Masculino Tactel Praia', unidade: 'UN', ncm: '62034900', cest: null,
      origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102' };
    const v = { codigo: 'S1', gtin: null, peso_gramas: null, ml_variation_id: null };
    const t = (d: string | null) => montarFiscalInformation({ ...base, descricao_fiscal: d }, v, { origin_type: 'reseller' }).title;
    expect(t('Short masculino')).toBe('Short masculino');
    expect(t(null)).toBe('Short Masculino Tactel Praia');
    expect(t('  ')).toBe('Short Masculino Tactel Praia');
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

describe('lerCanInvoice (por SKU, emenda D-10)', () => {
  it('lê GET /items/fiscal_information/{sku}; can_invoice true → pronto sem causa', async () => {
    let url = '';
    globalThis.fetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ sku: '00101', can_invoice: true }), { status: 200 });
    }) as typeof fetch;
    await expect(lerCanInvoice('tok', '00101')).resolves.toEqual({ pronto: true, causa: null });
    expect(url).toBe('https://api.mercadolibre.com/items/fiscal_information/00101');
  });

  it('can_invoice false → não pronto com causa preenchida', async () => {
    globalThis.fetch = fakeFetch([{ status: 200, body: { can_invoice: false, errors: ['X'] } }]);
    const r = await lerCanInvoice('tok', '00101');
    expect(r?.pronto).toBe(false);
    expect(r?.causa).toContain('errors');
  });

  it('404 → SKU sem dados fiscais no ML é pendência definitiva, não falha de leitura', async () => {
    globalThis.fetch = fakeFetch([{ status: 404 }]);
    await expect(lerCanInvoice('tok', '00101')).resolves.toEqual({
      pronto: false, causa: 'SKU sem dados fiscais no ML',
    });
  });

  it('outra resposta não-ok devolve null (sem lançar)', async () => {
    globalThis.fetch = fakeFetch([{ status: 500 }]);
    await expect(lerCanInvoice('tok', '00101')).resolves.toBeNull();
  });
});
