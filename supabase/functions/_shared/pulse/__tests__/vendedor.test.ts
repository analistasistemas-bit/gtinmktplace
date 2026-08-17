import { describe, it, expect } from 'vitest';
import { deveGravarVendedor, ufDoVendedor } from '../vendedor.ts';

describe('deveGravarVendedor', () => {
  it('sem linha anterior (1ª vez) → true', () => {
    expect(deveGravarVendedor(null, 20500)).toBe(true);
  });

  it('transactions_total mudou → true', () => {
    expect(deveGravarVendedor({ transactions_total: 20500 }, 20510)).toBe(true);
  });

  it('transactions_total igual → false', () => {
    expect(deveGravarVendedor({ transactions_total: 20500 }, 20500)).toBe(false);
  });

  // Sem isto, vendedor de volume estável ficaria para sempre sem UF na tela.
  it('UF aparecendo num vendedor de volume estável → true (backfill)', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: null }, 20500, 'SP')).toBe(true);
  });

  it('UF já guardada e igual → false (não regrava a cada execução)', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: 'SP' }, 20500, 'SP')).toBe(false);
  });

  it('ML que não expõe endereço não vira regravação infinita', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: null }, 20500, null)).toBe(false);
  });

  it('vendedor mudou de UF → true', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: 'SP' }, 20500, 'MG')).toBe(true);
  });
});

describe('ufDoVendedor', () => {
  it('extrai a sigla do formato ISO que o ML usa', () => {
    expect(ufDoVendedor({ address: { state: 'BR-SP' } })).toBe('SP');
  });

  it('aceita a sigla crua (o formato já variou entre respostas)', () => {
    expect(ufDoVendedor({ address: { state: 'mg' } })).toBe('MG');
  });

  // Uma coluna com "São Paulo" numa linha e "SP" na outra não dá para comparar de bater o olho.
  it('nome por extenso não vira UF', () => {
    expect(ufDoVendedor({ address: { state: 'São Paulo' } })).toBeNull();
  });

  it('ausente, vazio ou fora do formato → null', () => {
    expect(ufDoVendedor({ address: {} })).toBeNull();
    expect(ufDoVendedor({ address: { state: '' } })).toBeNull();
    expect(ufDoVendedor({ address: { state: 'BR-' } })).toBeNull();
    expect(ufDoVendedor({})).toBeNull();
    expect(ufDoVendedor(null)).toBeNull();
  });
});
