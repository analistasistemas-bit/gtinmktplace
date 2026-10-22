import { describe, expect, it, vi } from 'vitest';
import { analisarAnuncio, type DepsAnuncio, type EntradaAnuncio } from '../analisar-anuncio.ts';
import type { VariacaoCusto } from '../vinculo.ts';

const DIM = { altura_cm: 10, largura_cm: 10, comprimento_cm: 10, peso_gramas: 500 };

function v(over: Partial<VariacaoCusto> = {}): VariacaoCusto {
  return { variacaoId: 'v1', codigo: '001', custo: 10, origem: 'nacional', unidades: 1, codigoPai: '9001', dimensoes: DIM, ...over };
}

function deps(over: Partial<DepsAnuncio> & { cat?: VariacaoCusto[] } = {}): DepsAnuncio {
  return {
    porCatalogo: vi.fn(async () => over.cat ?? []),
    porGtin: vi.fn(async () => []),
    porVinculoManual: vi.fn(async () => null),
    contaDaOrg: vi.fn(async () => '111'),
    aliquotas: vi.fn(async () => ({ confirmada: true, nacional: null, importado: null })),
    comissao: vi.fn(async (_p: number, _c: string, tipo: 'gold_special' | 'gold_pro') =>
      ({ estado: 'ok' as const, valor: { percentual: tipo === 'gold_pro' ? 16 : 11, fixa: 0 } })),
    frete: vi.fn(async () => ({ estado: 'ok' as const, valor: 20 })),
    unidadesPorPacote: vi.fn(async () => ({ estado: 'ok' as const, valor: 1 })),
    dimensoesDoPacote: vi.fn(async () => null),
    ...over,
  };
}

const ent: EntradaAnuncio = { mlItemId: 'MLB999', sellerId: '222', catalogProductId: 'MLB123', categoriaId: 'MLB1', preco: 100, eanDaBusca: null };

describe('analisarAnuncio', () => {
  it('anúncio próprio: proprio true, margem null, sem consultar comissão/frete/vínculo', async () => {
    const d = deps({ contaDaOrg: vi.fn(async () => '222') });
    const r = await analisarAnuncio('org', { ...ent, sellerId: '222' }, d);
    expect(r.proprio).toBe(true);
    expect(r.margem).toBeNull();
    expect(r.custo).toEqual({ fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: null, unidadesSku: null, custoSku: null, fator: null, faltaUnidades: null, custoPacote: null });
    expect(r.parametros.frete).toEqual({ estado: 'indisponivel', motivo: 'anúncio próprio' });
    expect(d.comissao).not.toHaveBeenCalled();
    expect(d.frete).not.toHaveBeenCalled();
    expect(d.unidadesPorPacote).not.toHaveBeenCalled();
    expect(d.porCatalogo).not.toHaveBeenCalled();
  });

  it('alíquota não confirmada: clássico e premium indisponíveis', async () => {
    const d = deps({ cat: [v()], aliquotas: vi.fn(async () => ({ confirmada: false, nacional: 8, importado: 16 })) });
    const r = await analisarAnuncio('org', ent, d);
    const motivo = 'Confirme as alíquotas de imposto em Configurações';
    expect(r.margem!.classico).toEqual({ estado: 'indisponivel', motivo });
    expect(r.margem!.premium).toEqual({ estado: 'indisponivel', motivo });
    expect(r.parametros.aliquotas.confirmada).toBe(false);
  });

  it('família importado usa importado ?? 16', async () => {
    const r = await analisarAnuncio('org', ent, deps({ cat: [v({ origem: 'importado' })] }));
    const c = r.margem!.classico;
    expect(c.estado).toBe('ok');
    if (c.estado === 'ok') {
      expect(c.valor.imposto).toBe(16);
      expect(c.valor.lucro).toBe(100 - 11 - 16 - 20 - 10);
    }
    expect(r.custo).toMatchObject({ fonte: 'catalogo', codigo: '001', origem: 'importado', custoPacote: { estado: 'ok', valor: 10 } });
  });

  it('nacional usa a alíquota configurada', async () => {
    const d = deps({ cat: [v()], aliquotas: vi.fn(async () => ({ confirmada: true, nacional: 5, importado: 12 })) });
    const c = (await analisarAnuncio('org', ent, d)).margem!.premium;
    expect(c.estado === 'ok' && c.valor.imposto).toBe(5);
  });

  it('sem variação: custoPacote null, origem null, alíquota pede origem, frete do pacote padrão rotulado', async () => {
    const d = deps();
    const r = await analisarAnuncio('org', ent, d);
    expect(r.custo).toEqual({ fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: 1, unidadesSku: null, custoSku: null, fator: null, faltaUnidades: null, custoPacote: null });
    expect(r.margem!.classico).toEqual({ estado: 'indisponivel', motivo: 'Informe a origem do produto' });
    expect(r.parametros.classico.estado).toBe('ok');
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', null);
    expect(r.parametros.frete).toEqual({ estado: 'ok', valor: 20, aviso: 'estimado (pacote padrão)' });
  });

  // Vínculo por EAN (não por catálogo): a composição precisa ser provada pelas unidades dos dois lados.
  const porEan = (sku: Partial<VariacaoCusto>, unidadesAnuncio: Awaited<ReturnType<DepsAnuncio['unidadesPorPacote']>>, over: Partial<DepsAnuncio> = {}) =>
    deps({ porGtin: vi.fn(async () => [v(sku)]), unidadesPorPacote: vi.fn(async () => unidadesAnuncio), ...over });
  const entEan: EntradaAnuncio = { ...ent, eanDaBusca: '7899941205918' };

  it('casado pelo catálogo: mesmo produto → fator 1 e frete com as dimensões do SKU, sem aviso', async () => {
    const d = deps({ cat: [v({ unidades: null })], unidadesPorPacote: vi.fn(async () => ({ estado: 'indisponivel' as const, motivo: 'quantidade por anúncio não confirmada' })) });
    const r = await analisarAnuncio('org', ent, d);
    expect(r.custo).toMatchObject({ fonte: 'catalogo', fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok', valor: 10 } });
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', DIM);
    expect(r.parametros.frete).toEqual({ estado: 'ok', valor: 20 });
  });

  it('Codex #3: SKU caixa de 24 (UNITS_PER_PACK 24, sem kit) × anúncio de 24 → 1 caixa, R$ 10 (não R$ 240)', async () => {
    const r = await analisarAnuncio('org', entEan, porEan({ unidades: 24 }, { estado: 'ok', valor: 24 }));
    expect(r.custo).toMatchObject({ fonte: 'ean_da_busca', unidadesPorPacote: 24, unidadesSku: 24, custoSku: 10, fator: 1, custoPacote: { estado: 'ok', valor: 10 } });
  });

  it('Codex #3 (rodada 2): kit de 3 caixas de 24 (72 unidades, custo R$ 30) × anúncio de 72 → fator 1, R$ 30 (não R$ 720)', async () => {
    const r = await analisarAnuncio('org', entEan, porEan({ unidades: 72, custo: 30 }, { estado: 'ok', valor: 72 }));
    expect(r.custo).toMatchObject({ unidadesSku: 72, fator: 1, custoPacote: { estado: 'ok', valor: 30 } });
  });

  it('pacote de 3 de um SKU unitário → custo × 3', async () => {
    const r = await analisarAnuncio('org', entEan, porEan({ unidades: 1 }, { estado: 'ok', valor: 3 }));
    expect(r.custo).toMatchObject({ fator: 3, custoPacote: { estado: 'ok', valor: 30 } });
  });

  it('kit vinculado de 2 (UNITS_PER_PACK 2) × anúncio de 3 → composição diferente (razão não inteira)', async () => {
    const r = await analisarAnuncio('org', entEan, porEan({ unidades: 2 }, { estado: 'ok', valor: 3 }));
    expect(r.custo).toMatchObject({ fator: null, faltaUnidades: null, custoPacote: { estado: 'indisponivel', motivo: 'composição diferente' } });
  });

  it('só as unidades do SKU desconhecidas → faltaUnidades "sku", com o custo unitário do SKU', async () => {
    const r = await analisarAnuncio('org', entEan, porEan({ unidades: null }, { estado: 'ok', valor: 3 }));
    expect(r.custo).toMatchObject({ unidadesPorPacote: 3, unidadesSku: null, custoSku: 10, fator: null, faltaUnidades: 'sku', custoPacote: { estado: 'indisponivel', motivo: 'composição não confirmada' } });
  });

  it('os dois lados desconhecidos → faltaUnidades "ambos"', async () => {
    const r = await analisarAnuncio('org', { ...entEan, catalogProductId: null }, porEan({ unidades: null }, { estado: 'indisponivel', motivo: 'quantidade por anúncio não confirmada' }));
    expect(r.custo).toMatchObject({ unidadesPorPacote: null, unidadesSku: null, custoSku: 10, faltaUnidades: 'ambos', custoPacote: { estado: 'indisponivel', motivo: 'composição não confirmada' } });
  });

  it('SKU sem UNITS_PER_PACK confirmado → composição não confirmada (nunca 1)', async () => {
    const r = await analisarAnuncio('org', entEan, porEan({ unidades: null }, { estado: 'ok', valor: 1 }));
    expect(r.custo).toMatchObject({ fator: null, unidadesSku: null, custoSku: 10, custoPacote: { estado: 'indisponivel', motivo: 'composição não confirmada' } });
    const c = r.margem!.classico;
    expect(c.estado === 'ok' && [c.valor.custo, c.valor.lucro]).toEqual([null, null]);
  });

  it('Codex #4: anúncio fora de catálogo → quantidade por anúncio não confirmada, sem lucro (painel pede ao operador)', async () => {
    const motivo = 'quantidade por anúncio não confirmada';
    const r = await analisarAnuncio('org', { ...entEan, catalogProductId: null }, porEan({ unidades: 1 }, { estado: 'indisponivel', motivo }));
    expect(r.custo).toMatchObject({ unidadesPorPacote: null, unidadesSku: 1, custoSku: 10, fator: null, faltaUnidades: 'anuncio', custoPacote: { estado: 'indisponivel', motivo } });
    const c = r.margem!.classico;
    expect(c.estado === 'ok' && [c.valor.custo, c.valor.lucro, c.valor.avisos]).toEqual([null, null, ['estimado (pacote padrão)', motivo]]);
  });

  it('Codex #5: pacote de 3 sem kit vinculado de 3 → frete do pacote padrão rotulado "estimado", nunca as dimensões de 1 SKU', async () => {
    const d = porEan({ unidades: 1 }, { estado: 'ok', valor: 3 });
    const r = await analisarAnuncio('org', entEan, d);
    expect(d.dimensoesDoPacote).toHaveBeenCalledWith('org', '9001', 3);
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', null);
    expect(r.parametros.frete).toEqual({ estado: 'ok', valor: 20, aviso: 'estimado (pacote padrão)' });
  });

  it('pacote de 3 com kit vinculado de 3 da família → cota com as dimensões do kit, mas segue "estimado" (fator ≠ 1)', async () => {
    const KIT = { altura_cm: 12, largura_cm: 12, comprimento_cm: 30, peso_gramas: 1500 };
    const d = porEan({ unidades: 1 }, { estado: 'ok', valor: 3 }, { dimensoesDoPacote: vi.fn(async () => KIT) });
    const r = await analisarAnuncio('org', entEan, d);
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', KIT);
    expect(r.parametros.frete).toEqual({ estado: 'ok', valor: 20, aviso: 'estimado (pacote padrão)' });
  });

  it('fator 1 com dimensões do SKU → oficial, sem aviso (único caso sem rótulo)', async () => {
    const d = porEan({ unidades: 1 }, { estado: 'ok', valor: 1 });
    const r = await analisarAnuncio('org', entEan, d);
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', DIM);
    expect(r.parametros.frete).toEqual({ estado: 'ok', valor: 20 });
  });

  it('fator 1 com SKU sem dimensões → pacote padrão rotulado', async () => {
    const d = porEan({ unidades: 1, dimensoes: null }, { estado: 'ok', valor: 1 });
    const r = await analisarAnuncio('org', entEan, d);
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', null);
    expect(r.parametros.frete).toMatchObject({ aviso: 'estimado (pacote padrão)' });
  });

  it('composição desconhecida → frete do pacote padrão rotulado; dimensoesDoPacote nem é consultado', async () => {
    const d = porEan({ unidades: null }, { estado: 'ok', valor: 3 });
    const r = await analisarAnuncio('org', entEan, d);
    expect(d.dimensoesDoPacote).not.toHaveBeenCalled();
    expect(r.parametros.frete).toMatchObject({ aviso: 'estimado (pacote padrão)' });
  });

  it('unidadesPorPacote que lança → indisponível, a análise segue', async () => {
    const r = await analisarAnuncio('org', entEan, porEan({}, { estado: 'ok', valor: 1 }, { unidadesPorPacote: vi.fn(async () => { throw new Error('boom'); }) }));
    expect(r.custo.custoPacote).toEqual({ estado: 'indisponivel', motivo: 'unidades por pacote indisponíveis' });
  });

  it('SKU vinculado sem origem: margem indisponível "SKU sem origem cadastrada" (origem não presumida)', async () => {
    const d = deps({ cat: [], porVinculoManual: vi.fn(async (_o: string, c: { tipo: string }) => (c.tipo === 'item' ? v({ origem: null }) : null)) });
    const r = await analisarAnuncio('org', ent, d);
    const motivo = 'SKU sem origem cadastrada';
    expect(r.custo).toMatchObject({ fonte: 'vinculo_manual', codigo: '001', origem: null, custoPacote: { estado: 'ok', valor: 10 } });
    expect(r.margem!.classico).toEqual({ estado: 'indisponivel', motivo });
    expect(r.margem!.premium).toEqual({ estado: 'indisponivel', motivo });
  });

  it('dep do ML que lança vira indisponível, nunca zero', async () => {
    const d = deps({
      cat: [v()],
      comissao: vi.fn(async () => { throw new Error('boom'); }),
      frete: vi.fn(async () => { throw new Error('boom'); }),
    });
    const r = await analisarAnuncio('org', ent, d);
    const falha = { estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' };
    expect(r.parametros.classico).toEqual(falha);
    expect(r.parametros.premium).toEqual(falha);
    expect(r.parametros.frete).toEqual(falha);
    expect(r.margem!.classico.estado).toBe('indisponivel');
  });
});
