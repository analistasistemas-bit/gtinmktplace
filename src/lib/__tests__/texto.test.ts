import { describe, expect, it } from 'vitest';
import { normalizarParaBusca } from '../texto';

describe('normalizarParaBusca', () => {
  it('remove acentos comuns do português e converte para minúsculas', () => {
    expect(normalizarParaBusca('Macarrão')).toBe('macarrao');
    expect(normalizarParaBusca('CALÇA')).toBe('calca');
    expect(normalizarParaBusca('Órgão Público')).toBe('orgao publico');
    expect(normalizarParaBusca('Épico')).toBe('epico');
    expect(normalizarParaBusca('Açaí com Granola')).toBe('acai com granola');
  });

  it('lida com strings sem acento mantendo o conteúdo em minúsculas', () => {
    expect(normalizarParaBusca('macarrao')).toBe('macarrao');
    expect(normalizarParaBusca('TESTE')).toBe('teste');
  });

  it('trata nulo, indefinido e vazio com segurança', () => {
    expect(normalizarParaBusca('')).toBe('');
    expect(normalizarParaBusca(null)).toBe('');
    expect(normalizarParaBusca(undefined)).toBe('');
    expect(normalizarParaBusca('   ')).toBe('');
  });

  it('faz trim de espaços externos mas preserva internos', () => {
    expect(normalizarParaBusca('  Fita Métrica  ')).toBe('fita metrica');
  });

  it('é idempotente (normalizar duas vezes produz o mesmo resultado)', () => {
    const texto = 'Toalha de Algodão Felpuda 100% Bebê';
    const umaVez = normalizarParaBusca(texto);
    expect(normalizarParaBusca(umaVez)).toBe(umaVez);
  });
});
