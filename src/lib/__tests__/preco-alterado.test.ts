import { describe, expect, test } from 'vitest';
import { temAlteracaoPreco } from '../preco-alterado';

type VariacaoParcial = {
  precoPublicacao: number | null;
  precoPublicadoMl: number | null;
  excluidaDaPublicacao: boolean;
};

const fam = (vs: VariacaoParcial[]) => ({ variacoes: vs });

describe('temAlteracaoPreco', () => {
  test('detecta alteracao pelo preco efetivo colapsado', () => {
    expect(
      temAlteracaoPreco(fam([{ precoPublicacao: 22, precoPublicadoMl: 20, excluidaDaPublicacao: false }])),
    ).toBe(true);
    expect(
      temAlteracaoPreco(fam([{ precoPublicacao: 20, precoPublicadoMl: 20, excluidaDaPublicacao: false }])),
    ).toBe(false);
    expect(
      temAlteracaoPreco(fam([{ precoPublicacao: 22, precoPublicadoMl: null, excluidaDaPublicacao: false }])),
    ).toBe(false); // nunca publicado
  });

  test('cor excluida da publicacao nao gera badge', () => {
    expect(
      temAlteracaoPreco(fam([{ precoPublicacao: 22, precoPublicadoMl: 20, excluidaDaPublicacao: true }])),
    ).toBe(false);
  });
});
