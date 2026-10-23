import { describe, expect, it } from 'vitest';
import { montarRadar, type LinhaProdutoPulse } from '../radar.ts';

const produto = (o: Partial<LinhaProdutoPulse> = {}): LinhaProdutoPulse => ({
  id: 'p1', status: 'ativo', ultimo_snapshot_em: '2026-10-22T10:00:00Z', ptw_status: 'competing', ptw_preco_sugerido: 18.9,
  ptw_aplicavel: true, ptw_atualizado_em: '2026-10-22T09:00:00Z', meu_item_id: 'MLB1', meu_preco: 19.9, ...o,
});

describe('montarRadar (Task 18)', () => {
  it('fora do radar ou arquivado → noRadar false', () => {
    expect(montarRadar(null, [], [])).toEqual({ modulo: true, noRadar: false });
    expect(montarRadar(produto({ status: 'arquivado' }), [10], [])).toEqual({ modulo: true, noRadar: false });
  });

  it('no radar: menor preço observado e contagem só da última coleta; referência do ML só quando aplicável', () => {
    const r = montarRadar(produto(), [21.5, 18.4, 30], []);
    expect(r).toMatchObject({
      noRadar: true, status: 'ativo', ofertasAtivas: 3, menorPrecoObservado: 18.4, meuPreco: 19.9,
      referenciaML: { preco: 18.9, atualizadoEm: '2026-10-22T09:00:00Z' },
    });
  });

  it('sem coleta ainda: contagem e menor preço null (não zero); referência não aplicável e sem preço nosso ficam de fora', () => {
    const r = montarRadar(produto({ ultimo_snapshot_em: null, meu_preco: null, ptw_aplicavel: false }), [], []);
    expect(r).toMatchObject({ ultimaColetaEm: null, ofertasAtivas: null, menorPrecoObservado: null, referenciaML: null, meuPreco: null });
  });

  it('numeric que chega como texto vira número; texto inválido vira null', () => {
    const r = montarRadar(produto({ ptw_preco_sugerido: '32.99' as never, meu_preco: 'x' as never }), [], []);
    expect(r).toMatchObject({ referenciaML: { preco: 32.99 }, meuPreco: null });
  });

  it('alertas: só tipos conhecidos e campos exibidos (ids de item/vendedor não saem)', () => {
    const r = montarRadar(produto(), [], [
      { tipo: 'preco_caiu', payload: { de: 20, para: 18, meu_preco: 19 }, severidade: 'acao', criado_em: 't2' },
      { tipo: 'novo_concorrente', payload: { item_id: 'MLB9', seller_id: 7, preco: 17, nickname: 'LOJA' }, severidade: 'info', criado_em: 't1' },
      { tipo: 'outro', payload: {}, severidade: null, criado_em: 't0' },
    ]);
    expect(r.modulo && r.noRadar && r.alertas).toEqual([
      { tipo: 'preco_caiu', criadoEm: 't2', acao: true, de: 20, para: 18, preco: null, vendedor: null },
      { tipo: 'novo_concorrente', criadoEm: 't1', acao: false, de: null, para: null, preco: 17, vendedor: 'LOJA' },
    ]);
  });
});
