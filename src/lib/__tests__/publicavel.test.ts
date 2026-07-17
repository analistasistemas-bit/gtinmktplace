import { describe, expect, test } from 'vitest';
import { familiaPrecosDivergentes } from '../publicavel';

type VariacaoParcial = { preco: number; precoPublicacao: number | null; excluidaDaPublicacao: boolean };
const fam = (vs: VariacaoParcial[]) => ({ variacoes: vs });

describe('familiaPrecosDivergentes', () => {
  test('preços iguais entre cores incluídas: false', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
        ]),
      ),
    ).toBe(false);
  });

  test('preços diferentes entre cores incluídas: true', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 134, precoPublicacao: 134, excluidaDaPublicacao: false },
        ]),
      ),
    ).toBe(true);
  });

  test('cor excluída da publicação não conta na comparação', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 999, precoPublicacao: 999, excluidaDaPublicacao: true },
        ]),
      ),
    ).toBe(false);
  });

  test('família com 1 cor: nunca diverge', () => {
    expect(
      familiaPrecosDivergentes(fam([{ preco: 40.65, precoPublicacao: null, excluidaDaPublicacao: false }])),
    ).toBe(false);
  });

  test('família sem variações: false (não Infinity vs -Infinity)', () => {
    expect(familiaPrecosDivergentes(fam([]))).toBe(false);
  });

  test('usa precoPublicacao quando presente, cai para preco quando null', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 10, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 10, precoPublicacao: null, excluidaDaPublicacao: false },
        ]),
      ),
    ).toBe(true); // 40.65 (publicação da 1ª) vs 10 (fallback pro preço da planilha na 2ª)
  });
});
