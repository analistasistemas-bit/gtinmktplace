// ADR-0154 D-14: status ao vivo de Publicados ganha o Kit Virtual como 4ª fonte de ids, com
// preço/estoque vindos de duas chamadas extras SÓ para kit. Vitest (não Deno test) — é o runner
// que o CI e o vitest.config.ts realmente executam.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { montarStatusPublicados, type DepsStatusPublicados, type ItemStatusPublicados } from '../processar';
import { fakeConnector } from '../../_shared/canais/fake';
import type { ChannelConnector } from '../../_shared/canais/contrato';

const ORG = 'org-1';

interface DB {
  familias: Array<{ org_id: string; ml_item_id: string | null }>;
  anunciosExternos: Array<{ org_id: string; item_externo_id: string | null; canal: string }>;
  itensUP: Array<{ org_id: string; item_externo_id: string | null }>;
  kits: Array<{
    id: string; org_id: string; ml_item_id: string | null;
    ml_user_product_id: string | null; status: string;
  }>;
}

function dbVazio(): DB {
  return { familias: [], anunciosExternos: [], itensUP: [], kits: [] };
}

/** Fake mínimo do SupabaseClient: só `.from(t).select().eq()...eq().not()...not()`, que é
 *  exatamente o que `montarStatusPublicados` usa para as 4 fontes de leitura. */
function fakeAdmin(db: DB) {
  // deno-lint-ignore no-explicit-any
  function linhasDaTabela(tabela: string): any[] {
    if (tabela === 'familias') return db.familias;
    if (tabela === 'anuncios_externos') return db.anunciosExternos;
    if (tabela === 'anuncios_externos_itens') return db.itensUP;
    if (tabela === 'kits_virtuais') return db.kits;
    return [];
  }
  function chain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const filtros: Array<(r: any) => boolean> = [];
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      not: (c: string, _op: string, v: unknown) => { filtros.push((r) => (r[c] ?? null) !== v); return api; },
      then: (resolve: (x: { data: unknown; error: null }) => unknown) =>
        resolve({ data: linhasDaTabela(tabela).filter((r) => filtros.every((f) => f(r))), error: null }),
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (t: string) => chain(t) } as any;
}

function deps(db: DB, over: Partial<DepsStatusPublicados> = {}): DepsStatusPublicados {
  return {
    admin: fakeAdmin(db),
    resolverConexao: (async () => ({ id: 'conn-1' })) as unknown as DepsStatusPublicados['resolverConexao'],
    getConnector: (() => fakeConnector as unknown as ChannelConnector) as unknown as DepsStatusPublicados['getConnector'],
    getValidAccessTokenConexao: (async () => 'token-fake') as unknown as DepsStatusPublicados['getValidAccessTokenConexao'],
    lerPrecoKit: vi.fn(async () => null) as unknown as DepsStatusPublicados['lerPrecoKit'],
    lerEstoqueKit: vi.fn(async () => null) as unknown as DepsStatusPublicados['lerEstoqueKit'],
    ...over,
  };
}

function porId(itens: ItemStatusPublicados[], id: string) {
  return itens.find((i) => i.ml_item_id === id);
}

beforeEach(() => fakeConnector.reset());

describe('montarStatusPublicados', () => {
  it('org sem kit nenhum: resposta idêntica à de hoje (sem kitVirtual/kitId, sem chamadas extras)', async () => {
    const db = dbVazio();
    db.familias.push({ org_id: ORG, ml_item_id: 'MLB1' });
    db.anunciosExternos.push({ org_id: ORG, item_externo_id: 'MLB2', canal: 'mercado_livre' });
    db.itensUP.push({ org_id: ORG, item_externo_id: 'MLB3' });

    const d = deps(db);
    const resultado = await montarStatusPublicados(d, ORG);

    expect(resultado.itens).toHaveLength(3);
    expect(resultado.itens.map((i) => i.ml_item_id).sort()).toEqual(['MLB1', 'MLB2', 'MLB3']);
    for (const item of resultado.itens) {
      expect(item).toEqual({
        ml_item_id: item.ml_item_id,
        canal: 'mercado_livre',
        status: 'ativo',
        motivo: null,
        estoque: 10,
        preco: 9.9,
        listingType: 'classico',
        catalogForewarning: false,
      });
      expect(item).not.toHaveProperty('kitVirtual');
      expect(item).not.toHaveProperty('kitId');
    }
    expect(d.lerPrecoKit).not.toHaveBeenCalled();
    expect(d.lerEstoqueKit).not.toHaveBeenCalled();
  });

  it('kit publicado entra na lista com preço do /sale_price e estoque do /stock', async () => {
    const db = dbVazio();
    db.kits.push({
      id: 'kit-1', org_id: ORG, ml_item_id: 'MLBKIT1', ml_user_product_id: 'MLBU-KIT1', status: 'publicado',
    });

    const lerPrecoKit = vi.fn(async (_token: string, itemId: string) =>
      itemId === 'MLBKIT1' ? { preco: 150, totalComponentesAmount: 200, componentes: [] } : null);
    const lerEstoqueKit = vi.fn(async (_token: string, userProductId: string) =>
      userProductId === 'MLBU-KIT1' ? 7 : null);

    const d = deps(db, {
      lerPrecoKit: lerPrecoKit as unknown as DepsStatusPublicados['lerPrecoKit'],
      lerEstoqueKit: lerEstoqueKit as unknown as DepsStatusPublicados['lerEstoqueKit'],
    });
    const resultado = await montarStatusPublicados(d, ORG);

    expect(resultado.itens).toHaveLength(1);
    const item = porId(resultado.itens, 'MLBKIT1')!;
    expect(item.kitVirtual).toBe(true);
    expect(item.kitId).toBe('kit-1');
    expect(item.preco).toBe(150);
    expect(item.estoque).toBe(7);
    // status/sub_status seguem vindo do GET /items em lote (D-14) — não das chamadas extras.
    expect(item.status).toBe('ativo');

    expect(lerPrecoKit).toHaveBeenCalledWith('token-fake', 'MLBKIT1');
    expect(lerEstoqueKit).toHaveBeenCalledWith('token-fake', 'MLBU-KIT1');
  });

  it('falha do /sale_price de um kit: aquele kit sai sem preço, o resto da resposta sobrevive', async () => {
    const db = dbVazio();
    db.familias.push({ org_id: ORG, ml_item_id: 'MLB-FAMILIA' });
    db.kits.push(
      { id: 'kit-falha', org_id: ORG, ml_item_id: 'MLBKIT-FALHA', ml_user_product_id: 'UP-FALHA', status: 'publicado' },
      { id: 'kit-ok', org_id: ORG, ml_item_id: 'MLBKIT-OK', ml_user_product_id: 'UP-OK', status: 'publicado' },
    );

    const lerPrecoKit = vi.fn(async (_token: string, itemId: string) => {
      if (itemId === 'MLBKIT-FALHA') return null; // ML 500 / rede — a função real nunca lança
      if (itemId === 'MLBKIT-OK') return { preco: 88, totalComponentesAmount: 100, componentes: [] };
      return null;
    });
    const lerEstoqueKit = vi.fn(async () => 5);

    const d = deps(db, {
      lerPrecoKit: lerPrecoKit as unknown as DepsStatusPublicados['lerPrecoKit'],
      lerEstoqueKit: lerEstoqueKit as unknown as DepsStatusPublicados['lerEstoqueKit'],
    });
    const resultado = await montarStatusPublicados(d, ORG);

    expect(resultado.itens).toHaveLength(3);
    const kitFalha = porId(resultado.itens, 'MLBKIT-FALHA')!;
    expect(kitFalha.kitVirtual).toBe(true);
    expect(kitFalha.preco).toBeNull();
    expect(kitFalha.estoque).toBe(5); // estoque não depende do /sale_price — sobrevive junto

    const kitOk = porId(resultado.itens, 'MLBKIT-OK')!;
    expect(kitOk.preco).toBe(88);

    const familia = porId(resultado.itens, 'MLB-FAMILIA')!;
    expect(familia.preco).toBe(9.9); // preço do fakeConnector, intocado
    expect(familia).not.toHaveProperty('kitVirtual');
  });

  it('kit em erro ou encerrado não entra na resposta', async () => {
    const db = dbVazio();
    db.kits.push(
      { id: 'kit-erro', org_id: ORG, ml_item_id: 'MLBKIT-ERRO', ml_user_product_id: 'UP-ERRO', status: 'erro' },
      { id: 'kit-encerrado', org_id: ORG, ml_item_id: 'MLBKIT-FIM', ml_user_product_id: 'UP-FIM', status: 'encerrado' },
    );

    const d = deps(db);
    const resultado = await montarStatusPublicados(d, ORG);

    expect(resultado.itens).toEqual([]);
    expect(d.lerPrecoKit).not.toHaveBeenCalled();
    expect(d.lerEstoqueKit).not.toHaveBeenCalled();
  });
});
