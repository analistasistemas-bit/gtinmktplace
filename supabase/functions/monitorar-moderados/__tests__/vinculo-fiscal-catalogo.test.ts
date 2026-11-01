import { describe, expect, it, vi } from 'vitest';
import {
  listarCopiasCatalogo, resolverSkuPeloPrincipal, vincularCopiasCatalogo, type DepsCopias,
} from '../vinculo-fiscal-catalogo.ts';

function deps(o: Partial<DepsCopias> = {}): DepsCopias & Record<string, ReturnType<typeof vi.fn>> {
  return {
    moduloFiscal: vi.fn(async () => true),
    listarCopias: vi.fn(async () => ['MLBC1']),
    lerCopias: vi.fn(async () => [{ id: 'MLBC1', sku: '00101', principal: { id: 'MLB1', variation_id: null } }]),
    resolverSku: vi.fn(async () => null),
    skusComFiscal: vi.fn(async (_o: string, skus: string[]) => new Set(skus)),
    vincular: vi.fn(async () => {}),
    ...o,
  } as never;
}

describe('vincularCopiasCatalogo (emenda ADR-0135 01/11/2026)', () => {
  it('org sem módulo fiscal não chama o ML', async () => {
    const d = deps({ moduloFiscal: vi.fn(async () => false) });
    expect(await vincularCopiasCatalogo('o1', '123', 'tok', d)).toBe(0);
    expect(d.listarCopias).not.toHaveBeenCalled();
  });

  it('cópia com seller_custom_field vincula o SKU nela', async () => {
    const d = deps();
    expect(await vincularCopiasCatalogo('o1', '123', 'tok', d)).toBe(1);
    expect(d.vincular).toHaveBeenCalledWith('tok', { sku: '00101', item_id: 'MLBC1' });
    expect(d.resolverSku).not.toHaveBeenCalled();
  });

  it('cópia sem SKU resolve pelo principal', async () => {
    const d = deps({
      lerCopias: vi.fn(async () => [{ id: 'MLBC1', sku: null, principal: { id: 'MLB1', variation_id: '77' } }]),
      resolverSku: vi.fn(async () => '00202'),
    });
    await vincularCopiasCatalogo('o1', '123', 'tok', d);
    expect(d.resolverSku).toHaveBeenCalledWith('o1', { id: 'MLB1', variation_id: '77' });
    expect(d.vincular).toHaveBeenCalledWith('tok', { sku: '00202', item_id: 'MLBC1' });
  });

  it('cópia sem relação, sem SKU resolvido ou SKU sem fiscal → pula', async () => {
    const d = deps({
      lerCopias: vi.fn(async () => [
        { id: 'A', sku: '1', principal: null },
        { id: 'B', sku: null, principal: { id: 'MLB1', variation_id: null } },
        { id: 'C', sku: 'SEMFISCAL', principal: { id: 'MLB2', variation_id: null } },
      ]),
      skusComFiscal: vi.fn(async () => new Set<string>()),
    });
    expect(await vincularCopiasCatalogo('o1', '123', 'tok', d)).toBe(0);
    expect(d.vincular).not.toHaveBeenCalled();
  });

  it('erro numa cópia não para as outras', async () => {
    const d = deps({
      lerCopias: vi.fn(async () => [
        { id: 'A', sku: '1', principal: { id: 'P', variation_id: null } },
        { id: 'B', sku: '2', principal: { id: 'Q', variation_id: null } },
      ]),
      vincular: vi.fn(async (_t: string, v: { item_id: string }) => { if (v.item_id === 'A') throw new Error('400'); }),
    });
    expect(await vincularCopiasCatalogo('o1', '123', 'tok', d)).toBe(1);
    expect(d.vincular).toHaveBeenCalledTimes(2);
  });

  it('erro ao resolver o SKU de uma cópia não para as outras (review Codex)', async () => {
    const d = deps({
      lerCopias: vi.fn(async () => [
        { id: 'A', sku: null, principal: { id: 'P', variation_id: null } },
        { id: 'B', sku: '2', principal: { id: 'Q', variation_id: null } },
      ]),
      resolverSku: vi.fn(async () => { throw new Error('db'); }),
    });
    expect(await vincularCopiasCatalogo('o1', '123', 'tok', d)).toBe(1);
    expect(d.vincular).toHaveBeenCalledWith('tok', { sku: '2', item_id: 'B' });
  });

  it('erro na busca das cópias propaga', async () => {
    const d = deps({ listarCopias: vi.fn(async () => { throw new Error('503'); }) });
    await expect(vincularCopiasCatalogo('o1', '123', 'tok', d)).rejects.toThrow('503');
  });
});

/** Fake do PostgREST: cada tabela devolve as linhas dadas; filtros são ignorados (o código filtra o que decide). */
function fakeAdmin(tabelas: Record<string, unknown[]>) {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not']) q[m] = () => q;
      q.then = (ok: (r: unknown) => unknown) => ok({ data: tabelas[t] ?? [], error: null });
      return q;
    },
  } as never;
}

describe('listarCopiasCatalogo (scan, sem teto de 1000)', () => {
  it('segue o scroll_id até página vazia, active e paused', async () => {
    const paginas: Record<string, { results: string[]; scroll_id?: string }[]> = {
      active: [{ results: ['A1', 'A2'], scroll_id: 's1' }, { results: ['A3'], scroll_id: 's2' }, { results: [] }],
      paused: [{ results: ['P1'], scroll_id: 'x' }, { results: [] }],
    };
    const urls: string[] = [];
    const get = vi.fn(async (c: string) => {
      urls.push(c);
      return paginas[c.includes('status=active') ? 'active' : 'paused'].shift();
    });
    expect(await listarCopiasCatalogo(get, '123')).toEqual(['A1', 'A2', 'A3', 'P1']);
    expect(urls[0]).toContain('search_type=scan&catalog_listing=true&status=active');
    expect(urls[1]).toContain('scroll_id=s1');
  });
});

describe('resolverSkuPeloPrincipal', () => {
  it('Legacy com variação: casa ml_variation_id', async () => {
    const admin = fakeAdmin({
      familias: [{ id: 'f1' }],
      variacoes: [{ codigo: 'A', ml_variation_id: '76', excluida_da_publicacao: false }, { codigo: 'B', ml_variation_id: '77', excluida_da_publicacao: false }],
    });
    expect(await resolverSkuPeloPrincipal(admin, 'o1', { id: 'MLB1', variation_id: '77' })).toBe('B');
  });

  it('sem variação: sentinela ADR-0084 (ml_variation_id = item id)', async () => {
    const admin = fakeAdmin({
      familias: [{ id: 'f1' }],
      variacoes: [{ codigo: 'A', ml_variation_id: 'MLB1', excluida_da_publicacao: false }],
    });
    expect(await resolverSkuPeloPrincipal(admin, 'o1', { id: 'MLB1', variation_id: null })).toBe('A');
  });

  it('UP: item filho do User Product', async () => {
    const admin = fakeAdmin({ anuncios_externos_itens: [{ sku: 'U1' }] });
    expect(await resolverSkuPeloPrincipal(admin, 'o1', { id: 'MLB5', variation_id: null })).toBe('U1');
  });

  it('partição >0 do split: chave de variacoes_externas com o mesmo variation_id', async () => {
    const admin = fakeAdmin({
      anuncios_externos: [{ variacoes_externas: { S1: { variation_id: '197178531346' }, S2: { variation_id: '197178531348' } } }],
    });
    expect(await resolverSkuPeloPrincipal(admin, 'o1', { id: 'MLB4828349403', variation_id: '197178531348' })).toBe('S2');
  });

  it('ambíguo ou não achado → null', async () => {
    const admin = fakeAdmin({
      anuncios_externos: [{ variacoes_externas: { S1: { variation_id: '1' }, S2: { variation_id: '2' } } }],
    });
    expect(await resolverSkuPeloPrincipal(admin, 'o1', { id: 'MLB9', variation_id: null })).toBeNull();
  });
});
