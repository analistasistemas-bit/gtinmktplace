import { describe, expect, it, vi } from 'vitest';
import { analisarAnuncio, type DepsAnuncio, type EntradaAnuncio } from '../analisar-anuncio.ts';
import type { VariacaoCusto } from '../vinculo.ts';

const DIM = { altura_cm: 10, largura_cm: 10, comprimento_cm: 10, peso_gramas: 500 };

function v(over: Partial<VariacaoCusto> = {}): VariacaoCusto {
  return { variacaoId: 'v1', codigo: '001', custo: 10, origem: 'nacional', unidades: 1, dimensoes: DIM, ...over };
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
    expect(r.custo).toEqual({ fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: 1, custoPacote: null });
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

  it('sem variação: custoPacote null, origem null, alíquota pede origem, sem lucro', async () => {
    const d = deps();
    const r = await analisarAnuncio('org', ent, d);
    expect(r.custo).toEqual({ fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: 1, custoPacote: null });
    expect(r.margem!.classico).toEqual({ estado: 'indisponivel', motivo: 'Informe a origem do produto' });
    expect(r.parametros.classico.estado).toBe('ok');
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', null);
  });

  it('frete recebe as dimensões da variação vinculada; unidades do pacote multiplicam o custo', async () => {
    const d = deps({ cat: [v()], unidadesPorPacote: vi.fn(async () => ({ estado: 'ok' as const, valor: 3 })) });
    const r = await analisarAnuncio('org', ent, d);
    expect(d.frete).toHaveBeenCalledWith(100, 'MLB1', DIM);
    expect(d.unidadesPorPacote).toHaveBeenCalledWith('MLB123');
    expect(r.custo.unidadesPorPacote).toBe(3);
    expect(r.custo.custoPacote).toEqual({ estado: 'ok', valor: 30 });
  });

  it('unidades por pacote indisponíveis → custoPacote indisponível com o motivo (nunca pacote de 1)', async () => {
    const motivo = 'unidades por pacote indisponíveis';
    const r = await analisarAnuncio('org', ent, deps({ cat: [v()], unidadesPorPacote: vi.fn(async () => ({ estado: 'indisponivel' as const, motivo })) }));
    expect(r.custo.custoPacote).toEqual({ estado: 'indisponivel', motivo });
    expect(r.custo.unidadesPorPacote).toBeNull();
    const c = r.margem!.classico;
    expect(c.estado === 'ok' && [c.valor.custo, c.valor.lucro, c.valor.avisos]).toEqual([null, null, [motivo]]);
  });

  it('unidadesPorPacote que lança → indisponível, a análise segue', async () => {
    const r = await analisarAnuncio('org', ent, deps({ cat: [v()], unidadesPorPacote: vi.fn(async () => { throw new Error('boom'); }) }));
    expect(r.custo.custoPacote).toEqual({ estado: 'indisponivel', motivo: 'unidades por pacote indisponíveis' });
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
