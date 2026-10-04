import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarGtinsDosItens } from '../pedidos.ts';
import bulk from './fixtures/bulk-pedidos-pxv-cores-bulk.json' with { type: 'json' };
import antigo from './fixtures/bulk-pedidos-pxv-cores-antigo.json' with { type: 'json' };
import ids from './fixtures/bulk-pedidos-pxv-cores-ids.json' with { type: 'json' };
afterEach(() => vi.unstubAllGlobals());

// ADR-0177: GTIN do faturamento (markup) lido pelo /items/bulk — mesma saída do endpoint antigo.
describe('buscarGtinsDosItens via bulk', () => {
  it('URL do bulk e GTINs iguais aos do envelope antigo, nos mesmos ids', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify(bulk)); }));
    const novo = await buscarGtinsDosItens('t', ids as string[]);
    expect(urls).toEqual([`https://api.mercadolibre.com/items/bulk?ids=${(ids as string[]).join(',')}&attributes=status_code,body.id,body.attributes`]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(antigo))));
    expect(novo).toEqual(await buscarGtinsDosItens('t', ids as string[]));
    expect(Object.keys(novo).length).toBeGreaterThan(0);
  });
  it('bloco do meio com HTTP 500: os outros dois sobrevivem com os GTINs certos', async () => {
    const todos = Array.from({ length: 45 }, (_, i) => `MLB${i}`);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      n++;
      if (n === 2) return new Response('x', { status: 500 });
      const q = new URL(u).searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify(q.map((id) => ({ status_code: 200, body: { id, attributes: [{ id: 'GTIN', value_name: `789${id.slice(3)}` }] } }))));
    }));
    const r = await buscarGtinsDosItens('t', todos);
    expect(n).toBe(3);
    expect(Object.keys(r).sort()).toEqual([...todos.slice(0, 20), ...todos.slice(40)].sort());
    expect(r.MLB0).toBe('7890');
  });
});
