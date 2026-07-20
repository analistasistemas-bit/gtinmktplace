import { describe, it, expect } from 'vitest';
import { detectarTipoAviamento } from '../detectar';

describe('detectarTipoAviamento (ADR-0009)', () => {
  it('detecta linha por palavras-chave', () => {
    expect(detectarTipoAviamento('LINHA P/COST.XIK 120 2000J CORES').tipo).toBe('linha');
    expect(detectarTipoAviamento('Linha de Costura Poliéster').tipo).toBe('linha');
    expect(detectarTipoAviamento('CONE 4000M COSTURA').tipo).toBe('linha');
  });

  it('detecta barbante como linha (fio de algodão) — lote #49', () => {
    expect(detectarTipoAviamento('BARBANTE BANDEIRANTE 4/6 570MT | 85% ALGODÃO').tipo).toBe('linha');
    expect(detectarTipoAviamento('BARBANTE BANDEIRANTES 4/8 465MT | ALTA RESISTÊNCIA').tipo).toBe('linha');
    expect(detectarTipoAviamento('Barbantes Coloridos').tipo).toBe('linha');
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

  it('detecta cola (bastão de cola quente)', () => {
    expect(detectarTipoAviamento('COLA EM BASTAO 7MM FINA 1KG').tipo).toBe('cola');
    expect(detectarTipoAviamento('Cola Quente em Bastão Grossa').tipo).toBe('cola');
    expect(detectarTipoAviamento('REFIL BASTÃO DE COLA 11MM').tipo).toBe('cola');
  });

  it('detecta cursor (deslizador de zíper) — ADR-0083, lote #36', () => {
    expect(detectarTipoAviamento('CURSOR N.3 NIQ S/TRAVA DE DESL P/ZIPER DE NYLON 1000UND').tipo).toBe('cursor');
    expect(detectarTipoAviamento('CURSOR N.5 BCO S/TRAVA DE DESL P/ZIPER DE NYLON 1000UND').tipo).toBe('cursor');
    expect(detectarTipoAviamento('Cursores para Zíper').tipo).toBe('cursor');
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
