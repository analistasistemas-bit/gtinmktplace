import { describe, it, expect } from 'vitest';
import { lerItens, lerOferta } from '../ml-oferta.ts';

// fetch falso por caminho; nunca o ML real.
function fetchFalso(rotas: Record<string, unknown>, chamadas: string[] = []): typeof fetch {
  return (async (url: string) => {
    const caminho = String(url).replace('https://api.mercadolibre.com', '');
    chamadas.push(caminho);
    const chave = Object.keys(rotas).find((k) => caminho.startsWith(k));
    if (!chave) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(rotas[chave]), { status: 200, headers: { 'x-version': '3' } });
  }) as typeof fetch;
}

const base = {
  '/user-products/UP-N/stock': { locations: [{ type: 'selling_address', quantity: 1 }] },
  '/users/me': { id: 99 },
};

describe('lerOferta: busca por UP vazia (indexação logo depois do CREATE)', () => {
  it('lança com buscaVazia quando a busca não traz item nenhum', async () => {
    const f = fetchFalso({ ...base, '/users/99/items/search': { results: [], paging: { total: 0 } } });
    const erro = await lerOferta('tok', 'UP-N', ['MLB-N'], f).catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe('UP UP-N: 0 de 0 itens lidos');
    expect(erro.buscaVazia).toBe(true);
  });

  it('página vazia com total > 0 é busca incompleta, não indexação', async () => {
    const f = fetchFalso({ ...base, '/users/99/items/search': { results: [], paging: { total: 2 } } });
    const erro = await lerOferta('tok', 'UP-N', ['MLB-N'], f).catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.buscaVazia).toBe(false);
  });
});

describe('lerItens: leitura direta, sem a busca por UP', () => {
  it('lê status e sub_status pelo /items/bulk', async () => {
    const chamadas: string[] = [];
    const f = fetchFalso({
      '/items/bulk': [{ status_code: 200, body: { id: 'MLB-N', user_product_id: 'UP-N', status: 'paused', sub_status: [] } }],
    }, chamadas);
    expect(await lerItens('tok', 'UP-N', ['MLB-N'], f)).toEqual([{ id: 'MLB-N', status: 'paused', subStatus: [] }]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatch(/^\/items\/bulk\?ids=MLB-N&/);
  });

  it('item de outro UP lança', async () => {
    const f = fetchFalso({
      '/items/bulk': [{ status_code: 200, body: { id: 'MLB-N', user_product_id: 'UP-X', status: 'paused', sub_status: [] } }],
    });
    await expect(lerItens('tok', 'UP-N', ['MLB-N'], f)).rejects.toThrow(/outro UP/);
  });
});
