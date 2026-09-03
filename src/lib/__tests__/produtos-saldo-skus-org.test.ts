import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchSkusEstoqueOrg } from '@/lib/produtos-saldo';

/** A RPC devolve um filter builder; o código só chama `.range(de, ate)` e aguarda o resultado. */
function paginas(linhas: Array<Record<string, unknown>>) {
  return () => ({
    range: (de: number, ate: number) => Promise.resolve({
      data: linhas.slice(de, ate + 1),
      error: null,
    }),
  });
}

/** Medido contra o PostgREST real (03/09/2026): RPC por POST IGNORA o header `Range` — devolve a
 *  lista inteira. Sem `{ get: true }`, cada página traria as mesmas 1000 primeiras linhas e o
 *  laço de paginação nunca terminaria de fato. Este fake reproduz isso. */
function paginasSoComGet(linhas: Array<Record<string, unknown>>) {
  return (_fn: string, _args: unknown, opts?: { get?: boolean }) => ({
    range: (de: number, ate: number) => Promise.resolve({
      data: opts?.get ? linhas.slice(de, ate + 1) : linhas,
      error: null,
    }),
  });
}

function sku(i: number) {
  return { codigo: `S${i}`, codigo_pai: 'P1', nome: 'Produto', cor: null, estoque: i };
}

beforeEach(() => rpc.mockReset());

describe('fetchSkusEstoqueOrg', () => {
  // Relato do Diego (03/09/2026): a RPC devolve `setof json` e o PostgREST corta em ~1000 linhas.
  // Com 8.491 SKUs na org, o picker de entrada só via o começo da lista e respondia "Nenhum SKU
  // encontrado" para qualquer produto depois disso — o filtro é client-side.
  it('pagina além do teto de 1000 do PostgREST', async () => {
    const todos = Array.from({ length: 2345 }, (_, i) => sku(i));
    rpc.mockImplementation(paginas(todos));
    const r = await fetchSkusEstoqueOrg();
    expect(r).toHaveLength(2345);
    // O SKU do fim da lista — o que antes nunca chegava na tela.
    expect(r.at(-1)!.codigo).toBe('S2344');
  });

  // Guarda contra a regressão que o mock ingênuo não pegaria: chamar por POST devolveria a lista
  // inteira a cada página e a paginação viraria um no-op silencioso.
  it('chama a RPC por GET — só assim o PostgREST aplica o Range', async () => {
    const todos = Array.from({ length: 1500 }, (_, i) => sku(i));
    rpc.mockImplementation(paginasSoComGet(todos) as never);
    const r = await fetchSkusEstoqueOrg();
    expect(r).toHaveLength(1500);
    expect(rpc.mock.calls[0]![2]).toEqual({ get: true });
  });

  it('uma página só quando a org cabe abaixo do teto', async () => {
    rpc.mockImplementation(paginas(Array.from({ length: 3 }, (_, i) => sku(i))));
    const r = await fetchSkusEstoqueOrg();
    expect(r.map((s) => s.codigo)).toEqual(['S0', 'S1', 'S2']);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('mapeia codigo_pai para codigoPai', async () => {
    rpc.mockImplementation(paginas([{ codigo: 'S1', codigo_pai: 'PAI9', nome: 'X', cor: 'Azul', estoque: 7 }]));
    const r = await fetchSkusEstoqueOrg();
    expect(r[0]).toEqual({ codigo: 'S1', codigoPai: 'PAI9', nome: 'X', cor: 'Azul', estoque: 7 });
  });

  it('erro da RPC vira exceção, não lista vazia silenciosa', async () => {
    rpc.mockImplementation(() => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }));
    await expect(fetchSkusEstoqueOrg()).rejects.toThrow('boom');
  });
});
