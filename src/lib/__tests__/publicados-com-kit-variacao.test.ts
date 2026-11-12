// Filtro "Com kit de variação" (ADR-0200): base e anúncio do kit, só com o filtro ligado.
import { describe, it, expect } from 'vitest';
import { filtrarPublicados, type PublicadoItem } from '../publicados';
import { estadoParaParams, paramsParaEstado } from '../publicados-url';

const item = (codigoPai: string): PublicadoItem => ({
  familiaId: codigoPai, codigoPai, gtin: null, titulo: 't', fornecedor: null, tipo: null,
  categoria: null, precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null,
  mlItemId: codigoPai, mlPermalink: null, publicadoEm: null,
});
const itens = [item('00000140'), item('00000250'), item('00000999')];
const codigos = new Set(['00000140', '00000250']); // base + kit

describe('filtro "somenteComKitVariacao"', () => {
  it('deixa só a base e o kit', () => {
    expect(filtrarPublicados(itens, { somenteComKitVariacao: true }, codigos).map((i) => i.codigoPai))
      .toEqual(['00000140', '00000250']);
  });
  it('sem o filtro a lista não muda', () => {
    expect(filtrarPublicados(itens, {}, codigos)).toHaveLength(3);
  });
  it('ligado sem o conjunto (módulo off) não mostra nada em vez de tudo', () => {
    expect(filtrarPublicados(itens, { somenteComKitVariacao: true })).toEqual([]);
  });
  it('vai e volta pela URL', () => {
    const e = { filtro: { somenteComKitVariacao: true }, ord: null, pagina: 1, tamanho: 10 };
    expect(estadoParaParams(e).get('comkit')).toBe('1');
    expect(paramsParaEstado(estadoParaParams(e)).filtro.somenteComKitVariacao).toBe(true);
  });
});
