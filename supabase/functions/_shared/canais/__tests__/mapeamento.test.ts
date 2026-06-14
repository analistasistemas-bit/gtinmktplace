import { describe, it, expect } from 'vitest';
import { mapearVariacoesExternas, mapearVariacoesPorSku, classificarErroCanal } from '../mapeamento.ts';

describe('mapearVariacoesExternas', () => {
  it('casa por seller_custom_field', () => {
    const result = [
      { id: 111, seller_custom_field: 'A1' },
      { id: 222, seller_custom_field: 'A2' },
    ];
    const canon = [{ sku: 'A1' }, { sku: 'A2' }];
    expect(mapearVariacoesExternas(result, canon)).toEqual({ A1: '111', A2: '222' });
  });

  it('cai para casar por índice quando o ML não ecoa seller_custom_field e as contagens batem', () => {
    const result = [{ id: 111 }, { id: 222 }];
    const canon = [{ sku: 'A1' }, { sku: 'A2' }];
    expect(mapearVariacoesExternas(result, canon)).toEqual({ A1: '111', A2: '222' });
  });

  it('não casa por índice quando as contagens divergem', () => {
    const result = [{ id: 111 }];
    const canon = [{ sku: 'A1' }, { sku: 'A2' }];
    expect(mapearVariacoesExternas(result, canon)).toEqual({});
  });
});

describe('mapearVariacoesPorSku', () => {
  it('casa só por seller_custom_field (sem fallback por índice)', () => {
    const vars = [
      { id: 111, seller_custom_field: 'A1' },
      { id: 222, seller_custom_field: 'A2' },
      { id: 333 }, // sem custom field → ignorada (UPDATE não casa por índice)
    ];
    expect(mapearVariacoesPorSku(vars)).toEqual({ A1: '111', A2: '222' });
  });

  it('lista vazia → objeto vazio', () => {
    expect(mapearVariacoesPorSku([])).toEqual({});
  });
});

describe('classificarErroCanal', () => {
  it('marca 5xx como retentável', () => {
    const e = Object.assign(new Error('x'), { status: 503 });
    expect(classificarErroCanal(e).retentavel).toBe(true);
  });

  it('preenche o status HTTP no erro', () => {
    const e = Object.assign(new Error('x'), { status: 400 });
    expect(classificarErroCanal(e).status).toBe(400);
  });

  it('marca o erro de foto transiente (retentavel=true) como retentável', () => {
    const e = Object.assign(new Error('foto'), { retentavel: true, status: 400 });
    expect(classificarErroCanal(e).retentavel).toBe(true);
  });

  it('marca 4xx comum como definitivo', () => {
    const e = Object.assign(new Error('título inválido'), { status: 400 });
    const r = classificarErroCanal(e);
    expect(r.retentavel).toBe(false);
    expect(r.mensagemOperador).toBe('título inválido');
  });
});
