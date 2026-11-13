// Filtro por tipo de kit em Publicados: semântica sobre o índice, URL e chip.
import { describe, it, expect } from 'vitest';
import { filtrarPublicados, indiceKits, type PublicadoItem } from '../publicados';
import { estadoParaParams, paramsParaEstado } from '../publicados-url';

const item = (codigoPai: string, extra: Partial<PublicadoItem> = {}): PublicadoItem => ({
  familiaId: codigoPai, codigoPai, gtin: null, titulo: 't', fornecedor: null, tipo: null,
  categoria: null, precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null,
  mlItemId: codigoPai, mlPermalink: null, publicadoEm: null, ...extra,
});
const itens = [
  item('BASE'), item('K4', { kitBaseCodigoPai: 'BASE' }), item('VBASE'), item('VKIT'),
  item('kit-virtual:1', { ehKitVirtual: true, kitVirtualComponentes: ['A'] }), item('A'), item('SOLO'),
];
const idx = indiceKits(
  itens,
  [{ codigoPai: 'K4', kitBaseCodigoPai: 'BASE', multiplicador: 4, status: 'publicado', mlItemId: 'MLB1', criadoEm: '2026-11-01T00:00:00Z' }],
  [{ codigoPaiBase: 'VBASE', codigoPaiKit: 'VKIT', pecasPorKit: 3, status: 'publicado' }],
);
const estado = (filtro: object) => ({ filtro, ord: null, pagina: 1, tamanho: 10 });

describe('filtro por kits', () => {
  it.each([
    ['qualquer', ['BASE', 'K4', 'VBASE', 'VKIT', 'kit-virtual:1', 'A']],
    ['vinculado', ['BASE', 'K4']],
    ['variacao', ['VBASE', 'VKIT']],
    ['virtual', ['kit-virtual:1', 'A']],
    ['sem', ['SOLO']],
  ] as const)('kit=%s', (kit, esperado) => {
    expect(filtrarPublicados(itens, { kit }, idx).map((i) => i.codigoPai)).toEqual(esperado);
  });
  it('sem índice (carregando ou falha), kit="sem" não esconde nenhuma linha', () => {
    expect(filtrarPublicados(itens, { kit: 'sem' }, undefined)).toHaveLength(itens.length);
  });
  it('URL: comkit=virtual vai e volta', () => {
    const p = estadoParaParams(estado({ kit: 'virtual' }));
    expect(p.toString()).toBe('comkit=virtual');
    expect(paramsParaEstado(p).filtro.kit).toBe('virtual');
  });
  it('URL: comkit=1 antigo vira kit variacao', () => {
    expect(paramsParaEstado(new URLSearchParams('comkit=1')).filtro.kit).toBe('variacao');
  });
  it('URL: comkit inválido é ignorado', () => {
    expect(paramsParaEstado(new URLSearchParams('comkit=xyz')).filtro.kit).toBeUndefined();
  });
  it('URL: o filtro nunca escreve o parâmetro kit', () => {
    expect(estadoParaParams(estado({ kit: 'variacao' })).has('kit')).toBe(false);
  });
  it('URL: o deep link ?kit=<id> não vira filtro', () => {
    expect(paramsParaEstado(new URLSearchParams('kit=abc-123')).filtro.kit).toBeUndefined();
  });
});
