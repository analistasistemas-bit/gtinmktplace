import { describe, expect, it } from 'vitest';
import { variacoesDivergem } from '../processar.ts';

const gravada = (over = {}) => ({ nome: 'Azul', gtin: '789', preco: 10.5, custo: 4.25, ...over });
const enviada = (over = {}) => ({ nome: 'Azul', gtin: '789', preco: 10.5, custo: 4.25, ...over });

describe('variacoesDivergem', () => {
  it('reenvio idêntico não diverge', () => {
    expect(variacoesDivergem([enviada()], [gravada()])).toBe(false);
  });

  it('normalização: espaços e string vazia equivalem ao que foi gravado', () => {
    expect(variacoesDivergem(
      [enviada({ nome: '  Azul  ', gtin: '' })],
      [gravada({ nome: 'Azul', gtin: null })],
    )).toBe(false);
  });

  it('nulos em ambos os lados não divergem', () => {
    expect(variacoesDivergem(
      [enviada({ nome: null, gtin: null, custo: null })],
      [gravada({ nome: null, gtin: null, custo: null })],
    )).toBe(false);
  });

  it('contagem diferente diverge', () => {
    expect(variacoesDivergem([enviada(), enviada()], [gravada()])).toBe(true);
  });

  it('reordenação diverge', () => {
    const a = enviada({ nome: 'Azul' });
    const b = enviada({ nome: 'Verde' });
    expect(variacoesDivergem([b, a], [gravada({ nome: 'Azul' }), gravada({ nome: 'Verde' })])).toBe(true);
  });

  it('preço alterado em um centavo diverge', () => {
    expect(variacoesDivergem([enviada({ preco: 10.51 })], [gravada({ preco: 10.5 })])).toBe(true);
  });

  it('custo alterado diverge — alimenta markup (ADR-0055)', () => {
    expect(variacoesDivergem([enviada({ custo: 4.26 })], [gravada({ custo: 4.25 })])).toBe(true);
  });

  it('custo que sai de ausente para preenchido diverge', () => {
    expect(variacoesDivergem([enviada({ custo: 4.25 })], [gravada({ custo: null })])).toBe(true);
  });

  it('nome ou gtin alterado diverge', () => {
    expect(variacoesDivergem([enviada({ nome: 'Verde' })], [gravada()])).toBe(true);
    expect(variacoesDivergem([enviada({ gtin: '111' })], [gravada()])).toBe(true);
  });

  it('preço vindo do PostgREST como string compara igual', () => {
    expect(variacoesDivergem([enviada({ preco: 10.5 })], [gravada({ preco: '10.50' })])).toBe(false);
  });

  it('peso e dimensões alterados divergem', () => {
    expect(variacoesDivergem(
      [enviada({ pesoGramas: 500 })],
      [gravada({ peso_gramas: 400 })],
    )).toBe(true);
    expect(variacoesDivergem(
      [enviada({ alturaCm: 10 })],
      [gravada({ altura_cm: 12 })],
    )).toBe(true);
  });

  it('troca de posição entre linhas que só diferem no custo diverge', () => {
    // Sem comparar `custo`, estas duas seriam indistinguíveis e a troca passaria —
    // aplicando o estoque inicial de uma no SKU da outra.
    const a = enviada({ custo: 4.25 });
    const b = enviada({ custo: 9.9 });
    expect(variacoesDivergem([b, a], [gravada({ custo: 4.25 }), gravada({ custo: 9.9 })])).toBe(true);
  });

  it('preço com empate de arredondamento não é falso positivo', () => {
    // `1.005 * 100` em IEEE dá 100.49999…, mas numeric(12,2) guarda 1.01.
    // Só passa se a gravação arredondar antes (Step 3b).
    expect(variacoesDivergem([enviada({ preco: 1.005 })], [gravada({ preco: '1.01' })])).toBe(false);
  });
});
