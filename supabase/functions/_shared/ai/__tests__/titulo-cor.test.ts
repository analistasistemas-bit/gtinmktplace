import { describe, it, expect } from 'vitest';
import { garantirCorTitulo, garantirMetragemTitulo } from '../titulo';

describe('garantirCorTitulo', () => {
  it('crava a cor no 1º segmento quando a família é mono-cor e a cor não está no título', () => {
    const out = garantirCorTitulo('ALFINETE DE SEGURANÇA N.0 100UND | 100% FERRO', 'Prata', 1);
    expect(out).toBe('ALFINETE DE SEGURANÇA N.0 100UND PRATA | 100% FERRO');
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it('diferencia duas cores do mesmo produto (não gera títulos idênticos)', () => {
    const base = 'ALFINETE DE SEGURANÇA N.0 100UND | 100% FERRO';
    const prata = garantirCorTitulo(base, 'Prata', 1);
    const dourado = garantirCorTitulo(base, 'Dourado', 1);
    expect(prata).toContain('PRATA');
    expect(dourado).toContain('DOURADO');
    expect(prata).not.toBe(dourado);
  });

  it('é idempotente quando a cor já aparece no título (case-insensitive)', () => {
    const titulo = 'ALFINETE DE SEGURANÇA N.0 PRATA 100UND | 100% FERRO';
    expect(garantirCorTitulo(titulo, 'Prata', 1)).toBe(titulo);
  });

  it('detecta a cor já presente ignorando acentos', () => {
    const titulo = 'CADARÇO CAFE 1,5CM | ALGODÃO'; // sem acento no título
    expect(garantirCorTitulo(titulo, 'Café', 1)).toBe(titulo);
  });

  it('não toca no título quando a família é multi-cor', () => {
    const titulo = 'ALFINETE DE SEGURANÇA N.0 100UND | 100% FERRO';
    expect(garantirCorTitulo(titulo, 'Prata', 2)).toBe(titulo);
  });

  it('não toca no título quando a cor é nula', () => {
    const titulo = 'ALFINETE DE SEGURANÇA N.0 100UND | 100% FERRO';
    expect(garantirCorTitulo(titulo, null, 1)).toBe(titulo);
  });

  it('não crava o placeholder de cor não identificada', () => {
    const titulo = 'ALFINETE DE SEGURANÇA N.0 100UND | 100% FERRO';
    expect(garantirCorTitulo(titulo, '(sem cor identificada)', 1)).toBe(titulo);
  });

  it('não crava "Outra" — veredito do Vision para cor não identificada (lote #31)', () => {
    const titulo = 'LÁPIS COMUM FANTASIA POTE C/72UND | ESTAMPAS VIBRANTES';
    expect(garantirCorTitulo(titulo, 'Outra', 1)).toBe(titulo);
  });

  it('derruba o diferencial para caber a cor em 60 chars', () => {
    const out = garantirCorTitulo(
      'ALFINETE DE SEGURANÇA N.02 100UND | 100% FERRO | RESISTENTE',
      'Dourado',
      1,
    );
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain('DOURADO');
  });

  it('preserva a cor mesmo quando não há segmento de diferencial para derrubar', () => {
    const out = garantirCorTitulo(
      'ALFINETE DE SEGURANCA NUMERO ZERO EXTRA REFORCADO RESISTENTE OK',
      'Prata',
      1,
    );
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain('PRATA');
  });

  it('detecta cor multi-palavra já coberta fora de ordem — não duplica (lote #33)', () => {
    // nome_pai "RESINA DE 7 VERDE": "7" e "VERDE" já estão no título, só que na ordem inversa
    // da cor real "Verde 7". Antes do fix, isso duplicava " VERDE 7" no fim do título.
    const titulo = 'LÁPIS DE ESCREVER RESINA 7 VERDE REF.SL101066-8';
    expect(garantirCorTitulo(titulo, 'Verde 7', 1)).toBe(titulo);
  });

  it('cor multi-palavra parcialmente ausente ainda é cravada (preserva diferenciação)', () => {
    const titulo = 'LÁPIS DE ESCREVER RESINA VERDE REF.SL101066-8';
    const out = garantirCorTitulo(titulo, 'Verde 7', 1);
    expect(out).toContain('VERDE 7');
  });

  it('encadeia com garantirMetragemTitulo mantendo metragem e cor (≤60)', () => {
    const out = garantirCorTitulo(
      garantirMetragemTitulo('FITAS PROGRESSO N.1 | 100% POLIÉSTER | VERSÁTIL', 'FITA CETIM PROGRESSO N.1 100MT'),
      'Vermelho',
      1,
    );
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain('100MT');
    expect(out).toContain('VERMELHO');
  });
});
