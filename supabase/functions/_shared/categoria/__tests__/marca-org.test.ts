import { describe, it, expect } from 'vitest';
import { lerMarcaOrg, marcaDoProduto, forcarMarcaPropria, type MarcaOrg } from '../marca-org';

const zaven: MarcaOrg = { marcaPadrao: 'Zaven', marcaPropria: true };
const avil: MarcaOrg = { marcaPadrao: 'Avil', marcaPropria: false };

// deno-lint-ignore no-explicit-any
const adminCom = (resposta: { data?: unknown; error?: unknown }): any => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => resposta }) }) }),
});

describe('marcaDoProduto (ADR-0186)', () => {
  it('marca própria ignora o fornecedor', () => {
    expect(marcaDoProduto('STAR GLAMOUR', zaven)).toBe('Zaven');
    expect(marcaDoProduto(null, zaven)).toBe('Zaven');
  });
  it('sem marca própria mantém a regra antiga (fornecedor aparado ou nada)', () => {
    expect(marcaDoProduto(' BUFALO ', avil)).toBe('BUFALO');
    expect(marcaDoProduto('  ', avil)).toBeUndefined();
    expect(marcaDoProduto(undefined, avil)).toBeUndefined();
  });
});

describe('forcarMarcaPropria (ADR-0186)', () => {
  it('troca BRAND/MANUFACTURER pela marca da org e descarta value_id', () => {
    const attrs = [
      { id: 'BRAND', value_name: 'FEIRA', value_id: '9' },
      { id: 'COLOR', value_name: 'Azul' },
      { id: 'MANUFACTURER', value_name: 'FEIRA' },
    ];
    expect(forcarMarcaPropria(attrs, zaven)).toEqual([
      { id: 'BRAND', value_name: 'Zaven' },
      { id: 'COLOR', value_name: 'Azul' },
      { id: 'MANUFACTURER', value_name: 'Zaven' },
    ]);
  });
  it('sem marca própria devolve o mesmo array', () => {
    const attrs = [{ id: 'BRAND', value_name: 'BUFALO' }];
    expect(forcarMarcaPropria(attrs, avil)).toBe(attrs);
  });
  it('mantém BRAND que já é a marca da org, com o value_id do ML (não desagrupa a família UP)', () => {
    const attrs = [{ id: 'BRAND', value_name: 'zaven', value_id: '777' }];
    expect(forcarMarcaPropria(attrs, zaven)).toEqual([{ id: 'BRAND', value_name: 'zaven', value_id: '777' }]);
  });
  it('não adiciona BRAND ausente', () => {
    expect(forcarMarcaPropria([], zaven)).toEqual([]);
    expect(forcarMarcaPropria([{ id: 'MODEL', value_name: 'X' }], zaven)).toEqual([{ id: 'MODEL', value_name: 'X' }]);
  });
});

describe('lerMarcaOrg (ADR-0186)', () => {
  it('lê marca_padrao e marca_propria', async () => {
    await expect(lerMarcaOrg(adminCom({ data: { marca_padrao: 'Zaven', marca_propria: true } }), 'o'))
      .resolves.toEqual({ marcaPadrao: 'Zaven', marcaPropria: true });
    await expect(lerMarcaOrg(adminCom({ data: { marca_padrao: null, marca_propria: false } }), 'o'))
      .resolves.toEqual({ marcaPadrao: undefined, marcaPropria: false });
  });
  it('marca própria sem marca_padrao é erro (nunca cai no fornecedor nem em Avil)', async () => {
    await expect(lerMarcaOrg(adminCom({ data: { marca_padrao: ' ', marca_propria: true } }), 'o')).rejects.toThrow();
  });
  it('erro de leitura propaga', async () => {
    await expect(lerMarcaOrg(adminCom({ error: { message: 'boom' } }), 'o')).rejects.toThrow('boom');
  });
});
