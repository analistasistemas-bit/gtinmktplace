import { describe, it, expect } from 'vitest';
import { limparNomeProduto } from '../parser';

describe('limparNomeProduto', () => {
  it('remove o sufixo "(P)" com espaço no fim', () => {
    expect(limparNomeProduto('COLA EM BASTAO 7MM FINA 1KG (P)')).toBe('COLA EM BASTAO 7MM FINA 1KG');
  });

  it('remove o sufixo "(P)" colado (sem espaço)', () => {
    expect(limparNomeProduto('FITA CETIM PROGRESSO N.07 CORES 10MT(P)')).toBe('FITA CETIM PROGRESSO N.07 CORES 10MT');
  });

  it('remove "(p)" minúsculo e espaços sobrando', () => {
    expect(limparNomeProduto('LINHA P/COSTURA 1500MT CORES (p)  ')).toBe('LINHA P/COSTURA 1500MT CORES');
  });

  it('não altera nome sem o sufixo', () => {
    expect(limparNomeProduto('FITA CETIM PROGRESSO N.2 CORES 10MT')).toBe('FITA CETIM PROGRESSO N.2 CORES 10MT');
  });

  it('não confunde "P/" no meio do nome', () => {
    expect(limparNomeProduto('LINHA P/COSTURA 1500MT CORES')).toBe('LINHA P/COSTURA 1500MT CORES');
  });

  it('só remove no final, não no meio', () => {
    expect(limparNomeProduto('PRODUTO (P) EXTRA')).toBe('PRODUTO (P) EXTRA');
  });
});
