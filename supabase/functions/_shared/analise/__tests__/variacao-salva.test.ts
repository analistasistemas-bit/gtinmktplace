import { describe, it, expect } from 'vitest';
import { resumirVariacoesSalvas } from '../variacao-salva';

describe('resumirVariacoesSalvas', () => {
  it('sem linhas → dimensoes null e jaCadastrado false', () => {
    expect(resumirVariacoesSalvas([])).toEqual({ dimensoes: null, jaCadastrado: false });
  });

  it('linha com dimensões válidas → dimensoes preenchidas e jaCadastrado true', () => {
    const rows = [{ peso_gramas: 300, altura_cm: 6, largura_cm: 11, comprimento_cm: 16 }];
    expect(resumirVariacoesSalvas(rows)).toEqual({
      dimensoes: { peso_gramas: 300, altura_cm: 6, largura_cm: 11, comprimento_cm: 16 },
      jaCadastrado: true,
    });
  });

  it('linha existente com dimensões inválidas/null → dimensoes null mas jaCadastrado true', () => {
    const rows = [{ peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null }];
    expect(resumirVariacoesSalvas(rows)).toEqual({ dimensoes: null, jaCadastrado: true });
  });

  it('escolhe a primeira linha com dimensões válidas entre várias', () => {
    const rows = [
      { peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null },
      { peso_gramas: 300, altura_cm: 6, largura_cm: 11, comprimento_cm: 16 },
      { peso_gramas: 999, altura_cm: 9, largura_cm: 9, comprimento_cm: 9 },
    ];
    expect(resumirVariacoesSalvas(rows)).toEqual({
      dimensoes: { peso_gramas: 300, altura_cm: 6, largura_cm: 11, comprimento_cm: 16 },
      jaCadastrado: true,
    });
  });
});
