import { describe, it, expect } from 'vitest';
import { deveGravarVendedor, ufDoVendedor } from '../vendedor.ts';

describe('deveGravarVendedor', () => {
  const agoraMs = Date.UTC(2026, 7, 21, 12);
  const atual = { transactions_total: 20500, uf: 'SP' };

  it('sem linha anterior (1ª vez) → true', () => {
    expect(deveGravarVendedor(null, atual, agoraMs)).toBe(true);
  });

  it('transactions_total mudou → true', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: 'SP' }, { ...atual, transactions_total: 20510 }, agoraMs)).toBe(true);
  });

  it('transactions_total igual com perfil recente → false', () => {
    expect(deveGravarVendedor({
      transactions_total: 20500, uf: 'SP', perfil_coletado_em: new Date(agoraMs).toISOString(),
    }, atual, agoraMs)).toBe(false);
  });

  // Sem isto, vendedor de volume estável ficaria para sempre sem UF na tela.
  it('UF aparecendo num vendedor de volume estável → true (backfill)', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: null }, atual, agoraMs)).toBe(true);
  });

  it('UF já guardada e igual → false (não regrava a cada execução)', () => {
    expect(deveGravarVendedor({
      transactions_total: 20500, uf: 'SP', perfil_coletado_em: new Date(agoraMs).toISOString(),
    }, atual, agoraMs)).toBe(false);
  });

  it('ML que não expõe endereço não vira regravação infinita', () => {
    expect(deveGravarVendedor({
      transactions_total: 20500, uf: null, perfil_coletado_em: new Date(agoraMs).toISOString(),
    }, { transactions_total: 20500, uf: null }, agoraMs)).toBe(false);
  });

  it('vendedor mudou de UF → true', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: 'SP' }, { ...atual, uf: 'MG' }, agoraMs)).toBe(true);
  });

  it('snapshot legado sem perfil_coletado_em → true', () => {
    expect(deveGravarVendedor({ transactions_total: 20500, uf: 'SP' }, atual, agoraMs)).toBe(true);
  });

  it('perfil coletado há 23h59 → false', () => {
    expect(deveGravarVendedor({
      transactions_total: 20500,
      uf: 'SP',
      perfil_coletado_em: new Date(agoraMs - (24 * 60 * 60 * 1000 - 60 * 1000)).toISOString(),
    }, atual, agoraMs)).toBe(false);
  });

  it('perfil coletado há 24h exatas → true', () => {
    expect(deveGravarVendedor({
      transactions_total: 20500,
      uf: 'SP',
      perfil_coletado_em: new Date(agoraMs - 24 * 60 * 60 * 1000).toISOString(),
    }, atual, agoraMs)).toBe(true);
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
