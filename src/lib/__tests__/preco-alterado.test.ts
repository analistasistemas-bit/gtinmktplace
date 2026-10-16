import { describe, it, expect } from 'vitest';
import { temAlteracaoPreco } from '../preco-alterado';

const v = (precoPublicacao: number | null, precoPublicadoMl: number | null, excluida = false) =>
  ({ precoPublicacao, precoPublicadoMl, excluidaDaPublicacao: excluida });

describe('temAlteracaoPreco (F2: por variação)', () => {
  it('variação com preço a publicar ≠ confirmado no ML → badge', () => {
    expect(temAlteracaoPreco({ variacoes: [v(12, 10), v(10, 10)] })).toBe(true);
  });
  it('todas iguais ao confirmado → sem badge', () => {
    expect(temAlteracaoPreco({ variacoes: [v(10, 10), v(15, 15)] })).toBe(false);
  });
  it('preços divergentes entre si, mas cada um igual à sua faixa publicada → SEM badge (split no ar)', () => {
    expect(temAlteracaoPreco({ variacoes: [v(10, 10), v(12, 12)] })).toBe(false);
  });
  it('precoPublicadoMl null (nunca publicada) → sem badge', () => {
    expect(temAlteracaoPreco({ variacoes: [v(12, null)] })).toBe(false);
  });
  it('excluída não conta', () => {
    expect(temAlteracaoPreco({ variacoes: [v(12, 10, true)] })).toBe(false);
  });
  it('diferença abaixo de 1 centavo não acusa', () => {
    expect(temAlteracaoPreco({ variacoes: [v(10.001, 10.004)] })).toBe(false);
  });
  it('família já publicada → sem badge (escolha feita; "somente estoque" deixa a divergência de propósito)', () => {
    expect(temAlteracaoPreco({ status: 'publicado', variacoes: [v(10.45, 19)] })).toBe(false);
  });
  it('família pronta com divergência → badge', () => {
    expect(temAlteracaoPreco({ status: 'pronto', variacoes: [v(10.45, 19)] })).toBe(true);
  });
});
