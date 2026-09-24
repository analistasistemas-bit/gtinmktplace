import { describe, expect, it } from 'vitest';
import { montarCadastro, resolverCor, type LinhaVariacao } from '../cadastro.ts';

const v = (o: Partial<LinhaVariacao> & { id: string }): LinhaVariacao => ({
  custo: 10, preco: 18, cor: 'Azul', codigo: null, gtin: null, ml_variation_id: null,
  peso_gramas: 200, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: 'MLB1', origem: 'nacional' }, ...o,
});

describe('resolverCor', () => {
  it('item filho de User Products casa pelo anuncios_externos_itens, mesmo sem SKU (ADR-0105)', () => {
    const c = montarCadastro([v({ id: 'a', cor: 'Rosa' })], [{ item_externo_id: 'MLB900', variacao_id: 'a' }]);
    expect(resolverCor(c, { item_id: 'MLB900', variation_id: null, sku: null, gtin: null })?.cor).toBe('Rosa');
  });

  it('Legacy casa por ml_variation_id', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '555', cor: 'Verde' })], []);
    expect(resolverCor(c, { item_id: 'MLBx', variation_id: 555, sku: null, gtin: null })?.cor).toBe('Verde');
  });

  it('cai para GTIN e depois código/SKU, ignorando zeros à esquerda', () => {
    const c = montarCadastro([v({ id: 'a', codigo: '00123', gtin: '0789', familias: { ml_item_id: null, origem: 'nacional' } })], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '123', gtin: null })?.variacao_id).toBe('a');
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: null, gtin: '789' })?.variacao_id).toBe('a');
  });

  it('ml_item_id só resolve anúncio de variação única', () => {
    const mono = montarCadastro([v({ id: 'a' })], []);
    expect(resolverCor(mono, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })?.variacao_id).toBe('a');
    const multi = montarCadastro([v({ id: 'a' }), v({ id: 'b' })], []);
    expect(resolverCor(multi, { item_id: 'MLB1', variation_id: null, sku: null, gtin: null })).toBeNull();
  });

  it('duplicata: linha sem custo nunca vence linha com custo, mesmo mais nova', () => {
    const c = montarCadastro([
      v({ id: 'com', codigo: '8', custo: 6, atualizado_em: '2026-01-01T00:00:00Z', familias: { ml_item_id: null, origem: 'nacional' } }),
      v({ id: 'sem', codigo: '8', custo: null, atualizado_em: '2026-09-01T00:00:00Z', familias: { ml_item_id: null, origem: 'nacional' } }),
    ], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '8', gtin: null })?.variacao_id).toBe('com');
  });

  it('duplicata de código: vence a linha mais recente (ADR-0108)', () => {
    const c = montarCadastro([
      v({ id: 'velha', codigo: '7', custo: 5, atualizado_em: '2026-01-01T00:00:00Z' }),
      v({ id: 'nova', codigo: '7', custo: 9, atualizado_em: '2026-09-01T00:00:00Z' }),
    ], []);
    expect(resolverCor(c, { item_id: 'X', variation_id: null, sku: '7', gtin: null })?.custo).toBe(9);
  });

  it('custo ausente/≤0 ou não numérico vira null (⚪); origem inválida vira null', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', custo: 0, familias: { ml_item_id: 'M', origem: 'xx' } })], []);
    const r = resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!;
    expect(r.custo).toBeNull();
    expect(r.origem).toBeNull();
    expect(r.piso).toBe(18);
  });

  it('preço ≤0 vira piso null (evita verde falso com piso 0)', () => {
    for (const preco of [0, -5]) {
      const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', preco })], []);
      expect(resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!.piso).toBeNull();
    }
  });

  it('dimensões inválidas viram null (o frete usa o default do ML)', () => {
    const c = montarCadastro([v({ id: 'a', ml_variation_id: '1', altura_cm: null })], []);
    expect(resolverCor(c, { item_id: 'M', variation_id: 1, sku: null, gtin: null })!.dim).toBeNull();
  });

  it('nada casa → null', () => {
    expect(resolverCor(montarCadastro([], []), { item_id: 'Z', variation_id: 1, sku: 's', gtin: 'g' })).toBeNull();
  });
});
