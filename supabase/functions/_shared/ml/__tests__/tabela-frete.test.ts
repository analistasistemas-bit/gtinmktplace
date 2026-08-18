import { describe, it, expect, vi } from 'vitest';
import {
  montarTabelaFrete,
  FAIXAS_PRECO,
  FAIXAS_PESO,
} from '../tabela-frete';

describe('montarTabelaFrete', () => {
  it('monta grade 7×4 com labels das faixas', async () => {
    let chamadas = 0;
    const fetchFrete = vi.fn(async (_token, _mlUserId, preco, _cat, dim) => {
      chamadas++;
      const peso = dim?.peso_gramas ?? 0;
      return preco + peso / 1000;
    });

    const tabela = await montarTabelaFrete('tok', '123', 'MLB123', fetchFrete);

    expect(tabela.faixasPreco).toEqual(FAIXAS_PRECO);
    expect(tabela.faixasPeso).toEqual(FAIXAS_PESO);
    expect(tabela.celulas).toHaveLength(7);
    expect(tabela.celulas.every((linha) => linha.length === 4)).toBe(true);
    expect(chamadas).toBe(28);
    expect(fetchFrete).toHaveBeenCalledTimes(28);
  });

  it('preenche células na ordem peso × preço', async () => {
    const fetchFrete = vi.fn(async (_t, _u, preco, _c, dim) =>
      (dim?.peso_gramas ?? 0) * 100 + preco,
    );

    const { celulas } = await montarTabelaFrete('tok', '123', 'MLB999', fetchFrete);

    expect(celulas[0][0]).toBe(300 * 100 + 15);
    expect(celulas[0][3]).toBe(300 * 100 + 100);
    expect(celulas[6][0]).toBe(30000 * 100 + 15);
    expect(celulas[6][3]).toBe(30000 * 100 + 100);
  });

  it('passa dimensões cúbicas de cada faixa de peso', async () => {
    const fetchFrete = vi.fn(async () => 0);
    await montarTabelaFrete('tok', '123', 'MLB1', fetchFrete);

    expect(fetchFrete).toHaveBeenCalledWith(
      'tok', '123', 15, 'MLB1',
      { altura_cm: 14, largura_cm: 4, comprimento_cm: 4, peso_gramas: 300 },
    );
    expect(fetchFrete).toHaveBeenCalledWith(
      'tok', '123', 100, 'MLB1',
      { altura_cm: 31, largura_cm: 31, comprimento_cm: 31, peso_gramas: 30000 },
    );
  });

  it('FAIXAS_PRECO tem 4 labels representativos', () => {
    expect(FAIXAS_PRECO.map((f) => f.label)).toEqual([
      'Até R$ 18,99',
      'R$ 19 – R$ 48,99',
      'R$ 49 – R$ 78,99',
      '≥ R$ 79',
    ]);
    expect(FAIXAS_PRECO.map((f) => f.itemPrice)).toEqual([15, 35, 65, 100]);
  });

  it('FAIXAS_PESO tem 7 faixas de peso', () => {
    expect(FAIXAS_PESO).toHaveLength(7);
    expect(FAIXAS_PESO[0].label).toBe('Até 300 g');
    expect(FAIXAS_PESO[6].label).toBe('Até 30 kg');
  });
});
