import { describe, it, expect } from 'vitest';
import { lerMarcaOrg, marcaParaCriacao, marcaParaUpdate, forcarMarcaDoProduto } from '../marca-org';

// deno-lint-ignore no-explicit-any
const adminCom = (resposta: { data?: unknown; error?: unknown }): any => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => resposta }) }) }),
});

describe('marcaParaCriacao / marcaParaUpdate (ADR-0188)', () => {
  it('marca do produto vence o fornecedor', () => {
    expect(marcaParaCriacao({ marca: 'Lacoste', fornecedor: 'STAR' })).toBe('Lacoste');
    expect(marcaParaUpdate({ marca: 'Zaven', fornecedor: 'X' })).toBe('Zaven');
  });
  it('sem marca vale o fornecedor aparado (planilha, Avil)', () => {
    expect(marcaParaCriacao({ marca: null, fornecedor: ' BUFALO ' })).toBe('BUFALO');
    expect(marcaParaUpdate({ marca: '  ', fornecedor: 'BUFALO' })).toBe('BUFALO');
  });
  it('sem nada: criação deixa o montador decidir; UPDATE não envia BRAND (ADR-0016)', () => {
    expect(marcaParaCriacao({})).toBeUndefined();
    expect(marcaParaUpdate({ fornecedor: null })).toBeNull();
  });
});

describe('forcarMarcaDoProduto (ADR-0188)', () => {
  it('troca BRAND/MANUFACTURER pela marca do produto e descarta value_id', () => {
    expect(forcarMarcaDoProduto([
      { id: 'BRAND', value_name: 'FEIRA', value_id: '9' }, { id: 'COLOR', value_name: 'Azul' },
      { id: 'MANUFACTURER', value_name: 'FEIRA' },
    ], 'Zaven')).toEqual([
      { id: 'BRAND', value_name: 'Zaven' }, { id: 'COLOR', value_name: 'Azul' },
      { id: 'MANUFACTURER', value_name: 'Zaven' },
    ]);
  });
  it('mantém o que já é a marca, com o value_id do ML', () => {
    const attrs = [{ id: 'BRAND', value_name: 'zaven', value_id: '777' }];
    expect(forcarMarcaDoProduto(attrs, 'Zaven')).toEqual(attrs);
  });
  it('sem marca no produto devolve o mesmo array', () => {
    const attrs = [{ id: 'BRAND', value_name: 'BUFALO' }];
    expect(forcarMarcaDoProduto(attrs, null)).toBe(attrs);
    expect(forcarMarcaDoProduto(attrs, '  ')).toBe(attrs);
  });
  it('não adiciona BRAND ausente', () => {
    expect(forcarMarcaDoProduto([{ id: 'MODEL', value_name: 'X' }], 'Zaven')).toEqual([{ id: 'MODEL', value_name: 'X' }]);
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
