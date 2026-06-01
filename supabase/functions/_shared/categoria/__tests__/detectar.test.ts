import { describe, it, expect } from 'vitest';
import { detectarTipoAviamento } from '../detectar';

describe('detectarTipoAviamento (ADR-0009)', () => {
  it('detecta linha por palavras-chave', () => {
    expect(detectarTipoAviamento('LINHA P/COST.XIK 120 2000J CORES').tipo).toBe('linha');
    expect(detectarTipoAviamento('Linha de Costura Poliéster').tipo).toBe('linha');
    expect(detectarTipoAviamento('CONE 4000M COSTURA').tipo).toBe('linha');
  });

  it('detecta fita (tem prioridade sobre "costura" no texto)', () => {
    expect(detectarTipoAviamento('FITA CETIM PROGRESSO N.3 CORES 10MT').tipo).toBe('fita');
    expect(detectarTipoAviamento('Fita Gorgorão 22mm').tipo).toBe('fita');
    expect(detectarTipoAviamento('VIÉS 18MM').tipo).toBe('fita');
  });

  it('detecta botão', () => {
    expect(detectarTipoAviamento('BOTÃO DE PRESSÃO 12MM').tipo).toBe('botao');
    expect(detectarTipoAviamento('Botoes Acrilico').tipo).toBe('botao');
  });

  it('cai em "outro" quando nada bate', () => {
    expect(detectarTipoAviamento('PRODUTO XYZ 123').tipo).toBe('outro');
    expect(detectarTipoAviamento('').tipo).toBe('outro');
  });

  it('origem é sempre "regex" nesta camada', () => {
    expect(detectarTipoAviamento('LINHA').origem).toBe('regex');
    expect(detectarTipoAviamento('xyz').origem).toBe('regex');
  });

  it('ignora caixa e acentos parciais', () => {
    expect(detectarTipoAviamento('linha').tipo).toBe('linha');
    expect(detectarTipoAviamento('BOTAO').tipo).toBe('botao');
  });
});
