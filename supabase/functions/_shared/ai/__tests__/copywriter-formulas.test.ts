import { describe, it, expect } from 'vitest';
import { detectarFormulasProibidas } from '../copywriter-prompt';

describe('detectarFormulasProibidas — R3 (ADR-0098)', () => {
  it('texto limpo não acusa nada', () => {
    expect(detectarFormulasProibidas('Cone com 10.000 metros. Composição 100% poliéster.')).toEqual([]);
  });

  it('detecta prova social', () => {
    expect(detectarFormulasProibidas('A linha, reconhecida por profissionais, rende bem.'))
      .toContain('reconhecida por');
  });

  it('detecta intenção de projeto', () => {
    expect(detectarFormulasProibidas('Desenvolvida para suportar produção diária.'))
      .toContain('desenvolvida para');
  });

  it('detecta superlativo absoluto', () => {
    expect(detectarFormulasProibidas('Amplamente reconhecida como a melhor do mercado.'))
      .toContain('a melhor');
  });

  it('é insensível a acento e caixa', () => {
    expect(detectarFormulasProibidas('PREFERIDA PELOS PROFISSIONAIS DA COSTURA'))
      .toContain('preferida pelos profissionais');
  });

  it('não duplica a mesma fórmula repetida', () => {
    const r = detectarFormulasProibidas('Desenvolvida para X. Desenvolvida para Y.');
    expect(r.filter((f) => f === 'desenvolvida para')).toHaveLength(1);
  });

  it('acumula fórmulas distintas', () => {
    const r = detectarFormulasProibidas('Reconhecida por artesãos e desenvolvida para durar.');
    expect(r).toHaveLength(2);
  });

  it('não acusa "a mais" dentro de palavra maior (limite de palavra)', () => {
    expect(detectarFormulasProibidas('Produto para camas e roupas.')).toEqual([]);
  });

  it('não acusa quando o texto apenas cita metragem ancorada', () => {
    expect(detectarFormulasProibidas('A metragem de 10.000 metros permite maior tempo de uso.')).toEqual([]);
  });

  it('texto vazio ou nulo não quebra', () => {
    expect(detectarFormulasProibidas('')).toEqual([]);
    expect(detectarFormulasProibidas(undefined as unknown as string)).toEqual([]);
  });
});
