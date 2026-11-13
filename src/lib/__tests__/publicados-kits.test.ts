// Índice de kits por produto em Publicados: base ("tem") e anúncio do kit ("é").
import { describe, it, expect } from 'vitest';
import { indiceKits, type PublicadoItem } from '../publicados';

const item = (codigoPai: string, extra: Partial<PublicadoItem> = {}): PublicadoItem => ({
  familiaId: codigoPai, codigoPai, gtin: null, titulo: 't', fornecedor: null, tipo: null,
  categoria: null, precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null,
  mlItemId: codigoPai, mlPermalink: null, publicadoEm: null, ...extra,
});
type V = Parameters<typeof indiceKits>[1][number];
const v = (extra: Partial<V>): V => ({
  codigoPai: 'K4', kitBaseCodigoPai: 'BASE', multiplicador: 4, status: 'publicado',
  mlItemId: 'MLB1', criadoEm: '2026-11-01T00:00:00Z', ...extra,
});
type K = Parameters<typeof indiceKits>[2][number];
const kv = (extra: Partial<K> = {}): K => ({
  codigoPaiBase: 'BASE', codigoPaiKit: 'KITVAR', pecasPorKit: 3, status: 'publicado', ...extra,
});

describe('indiceKits', () => {
  it('base com kit vinculado: rótulo, detalhe em ordem de multiplicador e pior estado', () => {
    const idx = indiceKits([item('BASE')], [
      v({ codigoPai: 'K6', multiplicador: 6, status: 'publicando' }),
      v({ codigoPai: 'K4', multiplicador: 4, status: 'publicado', mlItemId: 'MLB1' }),
    ], []);
    expect(idx.get('BASE')).toEqual([{ tipo: 'vinculado', papel: 'tem', estado: 'montando',
      rotulo: 'Tem kit vinculado', detalhe: 'Kit vinculado: Kit 4 (ativo), Kit 6 (processando)' }]);
  });

  it('kit vinculado em erro vence montagem; pronto sem ml_item_id é aguardando', () => {
    const falha = indiceKits([item('BASE')], [
      v({ codigoPai: 'K4', multiplicador: 4, status: 'erro', mlItemId: null }),
      v({ codigoPai: 'K6', multiplicador: 6, status: 'publicando' }),
    ], []).get('BASE')![0];
    expect(falha.estado).toBe('falha');
    expect(falha.detalhe).toContain('Kit 4 (falhou)');

    const aguardando = indiceKits([item('BASE')], [
      v({ status: 'pronto', mlItemId: null }),
    ], []).get('BASE')![0];
    expect(aguardando.estado).toBe('aguardando');
    expect(aguardando.detalhe).toBe('Kit vinculado: Kit 4 (aguardando publicação)');
  });

  it('mesma base e multiplicador repetidos: vale o criadoEm mais recente', () => {
    const marca = indiceKits([item('BASE')], [
      v({ status: 'erro', mlItemId: null, criadoEm: '2026-11-01T00:00:00Z' }),
      v({ status: 'publicado', mlItemId: 'MLB1', criadoEm: '2026-11-10T00:00:00Z' }),
    ], []).get('BASE')![0];
    expect(marca.estado).toBe('normal');
    expect(marca.detalhe).toBe('Kit vinculado: Kit 4 (ativo)');
  });

  it('anúncio que é kit vinculado: Kit ×N e a base no detalhe', () => {
    const idx = indiceKits([item('K4', { kitBaseCodigoPai: 'BASE' })], [v({})], []);
    expect(idx.get('K4')).toEqual([{ tipo: 'vinculado', papel: 'e', estado: 'normal',
      rotulo: 'Kit ×4', detalhe: 'Este anúncio é um kit vinculado de BASE' }]);
  });

  it('anúncio que é kit vinculado sem linha em vinculados: rótulo genérico', () => {
    const marca = indiceKits([item('K4', { kitBaseCodigoPai: 'BASE' })], [], []).get('K4')![0];
    expect(marca.rotulo).toBe('Kit vinculado');
  });

  it('kit com variação: marca na base e no anúncio do kit; encerrado não acende', () => {
    const idx = indiceKits([item('BASE'), item('KITVAR')], [], [kv()]);
    expect(idx.get('BASE')).toEqual([{ tipo: 'variacao', papel: 'tem', estado: 'normal',
      rotulo: 'Tem kit com variação', detalhe: 'Kit com variação: Kit 3 · KITVAR' }]);
    expect(idx.get('KITVAR')).toEqual([{ tipo: 'variacao', papel: 'e', estado: 'normal',
      rotulo: 'Kit com variação', detalhe: 'Este anúncio é um kit com variação de BASE' }]);
    const enc = indiceKits([item('BASE'), item('KITVAR')], [], [kv({ status: 'encerrado' })]);
    expect(enc.get('BASE')).toBeUndefined();
    expect(enc.get('KITVAR')).toBeUndefined();
  });

  it('kit com variação: erro é falha, publicando/encerrando é montando', () => {
    expect(indiceKits([], [], [kv({ status: 'erro' })]).get('BASE')![0].estado).toBe('falha');
    expect(indiceKits([], [], [kv({ status: 'publicando' })]).get('BASE')![0].estado).toBe('montando');
    expect(indiceKits([], [], [kv({ status: 'encerrando' })]).get('BASE')![0].estado).toBe('montando');
  });

  it('base recebe a marca de variação mesmo sem o kit na lista de itens', () => {
    const idx = indiceKits([item('BASE')], [], [kv()]);
    expect(idx.get('BASE')).toHaveLength(1);
  });

  it('kit virtual: componente recebe "Compõe kit virtual" e codigo nulo é ignorado', () => {
    const kit = item('kit-virtual:1', {
      ehKitVirtual: true, titulo: 'Kit Escolar',
      kitVirtualComponentes: ['A', 'B', null as unknown as string],
    });
    const idx = indiceKits([kit, item('A'), item('B')], [], []);
    expect(idx.get('A')).toEqual([{ tipo: 'virtual', papel: 'tem', estado: 'normal',
      rotulo: 'Compõe kit virtual', detalhe: 'Compõe o kit virtual: Kit Escolar' }]);
    expect(idx.get('kit-virtual:1')).toEqual([{ tipo: 'virtual', papel: 'e', estado: 'normal',
      rotulo: 'Kit Virtual', detalhe: 'Kit virtual' }]);
    expect(idx.has(null as unknown as string)).toBe(false);
  });

  it('componente em dois kits virtuais: uma marca com os títulos separados por vírgula', () => {
    const k1 = item('kit-virtual:1', { ehKitVirtual: true, titulo: 'Kit A', kitVirtualComponentes: ['X'] });
    const k2 = item('kit-virtual:2', { ehKitVirtual: true, titulo: 'Kit B', kitVirtualComponentes: ['X'] });
    const marcas = indiceKits([k1, k2], [], []).get('X')!;
    expect(marcas).toHaveLength(1);
    expect(marcas[0].detalhe).toBe('Compõe o kit virtual: Kit A, Kit B');
  });

  it('anúncio que é kit vinculado e compõe kit virtual recebe as duas marcas', () => {
    const kit = item('kit-virtual:1', { ehKitVirtual: true, titulo: 'Kit Escolar', kitVirtualComponentes: ['K4'] });
    const idx = indiceKits([item('K4', { kitBaseCodigoPai: 'BASE' }), kit], [v({})], []);
    expect(idx.get('K4')!.map((m) => m.tipo)).toEqual(['vinculado', 'virtual']);
  });

  it('produto sem kit não entra no índice', () => {
    const idx = indiceKits([item('SOLTO')], [], []);
    expect(idx.has('SOLTO')).toBe(false);
  });
});
