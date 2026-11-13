// Filtro "Com kit de variação" (ADR-0200): base e anúncio do kit, via filtro de kits.
import { describe, it, expect } from 'vitest';
import { filtrarPublicados, indiceKits, type PublicadoItem } from '../publicados';
import { estadoParaParams, paramsParaEstado } from '../publicados-url';

const item = (codigoPai: string): PublicadoItem => ({
  familiaId: codigoPai, codigoPai, gtin: null, titulo: 't', fornecedor: null, tipo: null,
  categoria: null, precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null,
  mlItemId: codigoPai, mlPermalink: null, publicadoEm: null,
});
const itens = [item('00000140'), item('00000250'), item('00000999')];
const idx = indiceKits(itens, [], [
  { codigoPaiBase: '00000140', codigoPaiKit: '00000250', pecasPorKit: 3, status: 'publicado' },
]);

describe('filtro kit="variacao"', () => {
  it('deixa só a base e o kit', () => {
    expect(filtrarPublicados(itens, { kit: 'variacao' }, idx).map((i) => i.codigoPai))
      .toEqual(['00000140', '00000250']);
  });
  it('sem o filtro a lista não muda', () => {
    expect(filtrarPublicados(itens, {}, idx)).toHaveLength(3);
  });
  it('kit com variação encerrado não entra', () => {
    const enc = indiceKits(itens, [], [
      { codigoPaiBase: '00000140', codigoPaiKit: '00000250', pecasPorKit: 3, status: 'encerrado' },
    ]);
    expect(filtrarPublicados(itens, { kit: 'variacao' }, enc)).toEqual([]);
  });
  it('vai e volta pela URL', () => {
    const e = { filtro: { kit: 'variacao' as const }, ord: null, pagina: 1, tamanho: 10 };
    expect(estadoParaParams(e).get('kit')).toBe('variacao');
    expect(paramsParaEstado(estadoParaParams(e)).filtro.kit).toBe('variacao');
  });
});
