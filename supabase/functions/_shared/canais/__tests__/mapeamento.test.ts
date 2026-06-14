import { describe, it, expect } from 'vitest';
import { mapearVariacoesExternas, classificarErroCanal } from '../mapeamento.ts';

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

describe('classificarErroCanal', () => {
  it('marca 5xx como retentável', () => {
    const e = Object.assign(new Error('x'), { status: 503 });
    expect(classificarErroCanal(e).retentavel).toBe(true);
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
