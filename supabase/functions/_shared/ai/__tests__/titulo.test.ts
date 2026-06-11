import { describe, it, expect } from 'vitest';
import { clampTitulo, extrairMetragem, garantirMetragemTitulo, removerCaudaConectiva } from '../titulo';

describe('removerCaudaConectiva', () => {
  it('remove conectivo solto no fim ("VERSÁTIL E" → "VERSÁTIL")', () => {
    expect(removerCaudaConectiva('FITA CETIM N.1 100MT | 100% POLIÉSTER | VERSÁTIL E'))
      .toBe('FITA CETIM N.1 100MT | 100% POLIÉSTER | VERSÁTIL');
  });

  it('remove segmento que sobrou só com conectivo ("... | E" → "...")', () => {
    expect(removerCaudaConectiva('FITA N.1 100MT | 100% POLIÉSTER | E'))
      .toBe('FITA N.1 100MT | 100% POLIÉSTER');
  });

  it('remove vários conectivos encadeados e o pipe vazio', () => {
    expect(removerCaudaConectiva('FITA N.1 100MT | 100% POLIÉSTER | RESISTENTE E DE'))
      .toBe('FITA N.1 100MT | 100% POLIÉSTER | RESISTENTE');
  });

  it('não altera título já completo', () => {
    const ok = 'FITA CETIM N.1 100MT | 100% POLIÉSTER | RESISTENTE';
    expect(removerCaudaConectiva(ok)).toBe(ok);
  });

  it('limpa pipe pendurado no fim', () => {
    expect(removerCaudaConectiva('FITA N.1 100MT | 100% POLIÉSTER |'))
      .toBe('FITA N.1 100MT | 100% POLIÉSTER');
  });
});

describe('clampTitulo', () => {
  it('título já curto e completo permanece intacto', () => {
    const ok = 'COLA EM BASTÃO 11MM GROSSA 1KG | ADESÃO FIRME';
    expect(clampTitulo(ok)).toBe(ok);
  });

  it('derruba o segmento final inteiro quando estoura 60 (nunca corta palavra)', () => {
    // Sem maxLength no schema, a IA devolve o diferencial inteiro; o clamp derruba
    // o último segmento em vez de cortar "PISTOLAS" no meio (bug do lote #26).
    const out = clampTitulo('COLA EM BASTÃO 11MM GROSSA 1KG | ADESÃO FIRME | IDEAL PARA PISTOLAS');
    expect(out).toBe('COLA EM BASTÃO 11MM GROSSA 1KG | ADESÃO FIRME');
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it('derruba palavras inteiras quando há um só segmento longo (nunca mid-word)', () => {
    const out = clampTitulo('COLA EM BASTÃO QUENTE PROFISSIONAL GROSSA PARA PISTOLAS GRANDES MINI');
    expect(out.length).toBeLessThanOrEqual(60);
    // nenhuma palavra cortada: o resultado é prefixo de palavras inteiras do original
    expect('COLA EM BASTÃO QUENTE PROFISSIONAL GROSSA PARA PISTOLAS GRANDES MINI')
      .toContain(out);
    expect(out.endsWith(' ')).toBe(false);
  });

  it('limpa conectivo solto que sobra após derrubar segmento', () => {
    const out = clampTitulo('COLA EM BASTÃO 11MM GROSSA 1KG PARA | ADESÃO FORTE DURÁVEL E FIRME HOJE');
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.trim()).toBe(out);
    // não termina em conectivo nem pipe pendurado
    expect(/\b(E|DE|PARA|COM|OU)$/i.test(out)).toBe(false);
    expect(out.endsWith('|')).toBe(false);
  });
});

describe('extrairMetragem', () => {
  it('extrai metragem em MT preservando a unidade', () => {
    expect(extrairMetragem('FITA CETIM PROGRESSO N.1 CORES 100MT')).toBe('100MT');
    expect(extrairMetragem('FITA CETIM PROGRESSO N.1 CORES 10MT (P)')).toBe('10MT');
  });

  it('normaliza "metros" e espaços para M', () => {
    expect(extrairMetragem('FITA 50 METROS')).toBe('50M');
    expect(extrairMetragem('FITA 30 M')).toBe('30M');
  });

  it('retorna null quando não há metragem (jardas não conta)', () => {
    expect(extrairMetragem('LINHA P/COST.XIK 120 2000J 455')).toBeNull();
    expect(extrairMetragem('BOTAO MADREPEROLA N.24')).toBeNull();
  });

  it('não casa o "1" de N.1 nem códigos sem unidade de metro', () => {
    expect(extrairMetragem('FITA CETIM PROGRESSO N.1 209 VERMELHO')).toBeNull();
  });
});

describe('garantirMetragemTitulo', () => {
  it('injeta a metragem ausente e derruba o diferencial genérico para caber em 60', () => {
    const out = garantirMetragemTitulo(
      'FITAS PROGRESSO N.1 | 100% POLIÉSTER | VERSÁTIL E ELEGANTE',
      'FITA CETIM PROGRESSO N.1 CORES 100MT',
    );
    expect(out).toBe('FITAS PROGRESSO N.1 100MT | 100% POLIÉSTER');
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it('diferencia 10MT de 100MT (não gera títulos idênticos)', () => {
    const a = garantirMetragemTitulo(
      'FITAS PROGRESSO N.1 | 100% POLIÉSTER | VERSÁTIL',
      'FITA CETIM PROGRESSO N.1 CORES 100MT',
    );
    const b = garantirMetragemTitulo(
      'FITAS PROGRESSO N.1 | 100% POLIÉSTER | VERSÁTIL',
      'FITA CETIM PROGRESSO N.1 CORES 10MT (P)',
    );
    expect(a).toContain('100MT');
    expect(b).toContain('10MT');
    expect(a).not.toBe(b);
  });

  it('não duplica quando a IA já incluiu a metragem', () => {
    const titulo = 'FITA PROGRESSO N.1 100MT | 100% POLIÉSTER | RESISTENTE';
    expect(garantirMetragemTitulo(titulo, 'FITA CETIM PROGRESSO N.1 CORES 100MT')).toBe(titulo);
  });

  it('limpa conectivo solto mesmo com a metragem já presente (bug do upload real)', () => {
    expect(garantirMetragemTitulo(
      'FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | VERSÁTIL E',
      'FITA CETIM PROGRESSO N.1 CORES 100MT',
    )).toBe('FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | VERSÁTIL');
  });

  it('deixa o título intacto quando o nome não tem metragem', () => {
    const titulo = 'LINHA SETTA XIK TEX 120 | 100% POLIÉSTER | RESISTENTE';
    expect(garantirMetragemTitulo(titulo, 'LINHA SETTA XIK 2000J')).toBe(titulo);
  });

  it('produto sem metragem ainda assim é clampado sem cortar palavra (cola, lote #26)', () => {
    const out = garantirMetragemTitulo(
      'COLA EM BASTÃO 11MM GROSSA 1KG | ADESÃO FIRME | IDEAL PARA PISTOLAS',
      'COLA EM BASTAO 11MM GROSSA 1KG',
    );
    expect(out).toBe('COLA EM BASTÃO 11MM GROSSA 1KG | ADESÃO FIRME');
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it('mantém o resultado dentro de 60 caracteres mesmo sem segmentos para derrubar', () => {
    const out = garantirMetragemTitulo(
      'FITA CETIM PROGRESSO NUMERO UM EXTRA LONGA DE TESTE AQUI OK',
      'FITA 100MT',
    );
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain('100MT');
  });
});
