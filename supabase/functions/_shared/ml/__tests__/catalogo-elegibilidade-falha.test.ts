import { describe, it, expect, vi, afterEach } from 'vitest';
import { vincularVariacoesCatalogo, type VarCatalogoRow } from '../catalogo';

// Guard da spec 2026-08-12 (seção 1.2): "não perguntei" precisa ser distinguível de "perguntei e
// não havia dado". Falha de LEITURA da elegibilidade propaga (worker devolve 500 p/ retry);
// devolver resumo zerado finalizava a rodada em silêncio e consumia uma tentativa.
describe('vincularVariacoesCatalogo — falha de leitura da elegibilidade', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GET de elegibilidade lança (timeout/rede) → propaga, sem resumo zerado e sem writes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input).includes('/catalog_listing_eligibility')) throw new Error('timeout');
      return new Response('{}', { status: 200 });
    }));
    const writes: unknown[] = [];
    const admin = {
      from: () => ({
        update: (values: Record<string, unknown>) => ({
          eq: (_c: string, id: unknown) => { writes.push({ id, values }); return Promise.resolve({ error: null }); },
        }),
      }),
    };
    const vars: VarCatalogoRow[] = [{
      id: 'v1', codigo: '001', gtin: null, ml_variation_id: '123',
      catalog_product_id: null, catalog_listing_id: null,
    }];
    await expect(vincularVariacoesCatalogo('tok', admin as never, 'MLB-X', vars)).rejects.toThrow('timeout');
    expect(writes.length).toBe(0);
  });
});
