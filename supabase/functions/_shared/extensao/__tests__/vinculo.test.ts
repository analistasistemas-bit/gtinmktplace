import { describe, expect, it, vi } from 'vitest';
import { custoDoPacote, resolverVinculo, type DepsVinculo, type VariacaoCusto } from '../vinculo.ts';

function v(over: Partial<VariacaoCusto> = {}): VariacaoCusto {
  return { variacaoId: 'v1', codigo: '001', custo: 10, origem: 'nacional', unidades: 1, dimensoes: null, ...over };
}

function deps(over: Partial<{ cat: VariacaoCusto[]; gtin: VariacaoCusto[]; manual: (c: { tipo: string; valor: string }) => VariacaoCusto | null }> = {}) {
  return {
    porCatalogo: vi.fn(async () => over.cat ?? []),
    porGtin: vi.fn(async () => over.gtin ?? []),
    porVinculoManual: vi.fn(async (_o: string, c: { tipo: 'catalogo' | 'item'; valor: string }) => over.manual?.(c) ?? null),
  } satisfies DepsVinculo;
}

const EAN_OK = '7891000315507';
const ent = { catalogProductId: 'MLB123', mlItemId: 'MLB999', eanDaBusca: EAN_OK };

describe('resolverVinculo', () => {
  it('catálogo resolve e não consulta as etapas seguintes', async () => {
    const d = deps({ cat: [v({ variacaoId: 'cat' })] });
    const r = await resolverVinculo('org', ent, d);
    expect(r).toEqual({ fonte: 'catalogo', variacao: v({ variacaoId: 'cat' }) });
    expect(d.porCatalogo).toHaveBeenCalledWith('org', 'MLB123');
    expect(d.porGtin).not.toHaveBeenCalled();
    expect(d.porVinculoManual).not.toHaveBeenCalled();
  });

  it('catálogo vazio → EAN da busca', async () => {
    const d = deps({ gtin: [v({ variacaoId: 'g' })] });
    const r = await resolverVinculo('org', ent, d);
    expect(r.fonte).toBe('ean_da_busca');
    expect(r.variacao?.variacaoId).toBe('g');
    expect(d.porGtin).toHaveBeenCalledWith('org', EAN_OK);
    expect(d.porVinculoManual).not.toHaveBeenCalled();
  });

  it('catálogo ambíguo (>1) pula para o EAN', async () => {
    const d = deps({ cat: [v(), v({ variacaoId: 'v2' })], gtin: [v({ variacaoId: 'g' })] });
    const r = await resolverVinculo('org', ent, d);
    expect(r).toMatchObject({ fonte: 'ean_da_busca', variacao: { variacaoId: 'g' } });
  });

  it('GTIN ambíguo (>1) pula para o vínculo manual', async () => {
    const d = deps({ gtin: [v(), v({ variacaoId: 'v2' })], manual: (c) => (c.tipo === 'catalogo' ? v({ variacaoId: 'm' }) : null) });
    const r = await resolverVinculo('org', ent, d);
    expect(r).toMatchObject({ fonte: 'vinculo_manual', variacao: { variacaoId: 'm' } });
  });

  it('manual: tenta catálogo antes do item', async () => {
    const d = deps({ manual: (c) => (c.tipo === 'item' ? v({ variacaoId: 'i' }) : null) });
    const r = await resolverVinculo('org', ent, d);
    expect(r).toMatchObject({ fonte: 'vinculo_manual', variacao: { variacaoId: 'i' } });
    expect(d.porVinculoManual).toHaveBeenNthCalledWith(1, 'org', { tipo: 'catalogo', valor: 'MLB123' });
    expect(d.porVinculoManual).toHaveBeenNthCalledWith(2, 'org', { tipo: 'item', valor: 'MLB999' });
  });

  it('manual por catálogo resolve → não consulta o item', async () => {
    const d = deps({ manual: (c) => (c.tipo === 'catalogo' ? v() : null) });
    await resolverVinculo('org', ent, d);
    expect(d.porVinculoManual).toHaveBeenCalledTimes(1);
  });

  it('sem catálogo: não consulta porCatalogo nem manual por catálogo', async () => {
    const d = deps();
    const r = await resolverVinculo('org', { ...ent, catalogProductId: null }, d);
    expect(r).toEqual({ fonte: 'nenhuma', variacao: null });
    expect(d.porCatalogo).not.toHaveBeenCalled();
    expect(d.porVinculoManual).toHaveBeenCalledTimes(1);
    expect(d.porVinculoManual).toHaveBeenCalledWith('org', { tipo: 'item', valor: 'MLB999' });
  });

  it('EAN com dígito inválido é ignorado (não consulta porGtin)', async () => {
    const d = deps();
    const r = await resolverVinculo('org', { ...ent, eanDaBusca: '7891000315508' }, d);
    expect(r.fonte).toBe('nenhuma');
    expect(d.porGtin).not.toHaveBeenCalled();
  });

  it('EAN interno 3000* é aceito (régua de gtinOuNull)', async () => {
    const d = deps();
    await resolverVinculo('org', { ...ent, eanDaBusca: '3000123' }, d);
    expect(d.porGtin).toHaveBeenCalledWith('org', '3000123');
  });

  it.each(['', '   '])('EAN vazio %j não consulta porGtin', async (ean) => {
    const d = deps();
    await resolverVinculo('org', { ...ent, eanDaBusca: ean }, d);
    expect(d.porGtin).not.toHaveBeenCalled();
  });

  it('EAN nulo não consulta porGtin', async () => {
    const d = deps();
    await resolverVinculo('org', { ...ent, eanDaBusca: null }, d);
    expect(d.porGtin).not.toHaveBeenCalled();
  });

  it('nada encontrado → nenhuma', async () => {
    const d = deps();
    expect(await resolverVinculo('org', ent, d)).toEqual({ fonte: 'nenhuma', variacao: null });
    expect(d.porCatalogo).toHaveBeenCalledTimes(1);
    expect(d.porGtin).toHaveBeenCalledTimes(1);
    expect(d.porVinculoManual).toHaveBeenCalledTimes(2);
  });
});

describe('custoDoPacote', () => {
  it('custo 10, unidades 1, pack 2 → 20', () => {
    expect(custoDoPacote(v(), 2)).toEqual({ estado: 'ok', valor: 20 });
  });
  it('kit de 2, pack 2 → 10', () => {
    expect(custoDoPacote(v({ unidades: 2 }), 2)).toEqual({ estado: 'ok', valor: 10 });
  });
  it('kit de 2, pack 3 → composição diferente', () => {
    expect(custoDoPacote(v({ unidades: 2 }), 3)).toEqual({ estado: 'indisponivel', motivo: 'composição diferente' });
  });
  it('custo null → custo não cadastrado', () => {
    expect(custoDoPacote(v({ custo: null }), 1)).toEqual({ estado: 'indisponivel', motivo: 'custo não cadastrado' });
  });
  it('custo 10.1, pack 3 → 30.3 (sem resíduo de float)', () => {
    expect(custoDoPacote(v({ custo: 10.1 }), 3)).toEqual({ estado: 'ok', valor: 30.3 });
  });
  it.each([0, -2, 0.5])('unidades da variação %s → inválidas', (u) => {
    expect(custoDoPacote(v({ unidades: u }), 2)).toEqual({ estado: 'indisponivel', motivo: 'unidades da variação inválidas' });
  });
  it('custo NaN → custo inválido', () => {
    expect(custoDoPacote(v({ custo: NaN }), 1)).toEqual({ estado: 'indisponivel', motivo: 'custo inválido' });
  });
  it.each([0, -1, 1.5, NaN])('pack %s → unidades por pacote inválidas', (n) => {
    expect(custoDoPacote(v(), n)).toEqual({ estado: 'indisponivel', motivo: 'unidades por pacote inválidas' });
  });
});
