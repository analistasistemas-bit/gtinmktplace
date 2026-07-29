import { describe, it, expect } from 'vitest';
import { selecionarBaixas, refBaixa } from '../baixa';

describe('selecionarBaixas', () => {
  it('ignora item sem codigo', () => {
    expect(selecionarBaixas([{ codigo: null, quantity: 2 }])).toEqual([]);
  });

  it('ignora quantity <= 0', () => {
    expect(selecionarBaixas([
      { codigo: 'A1', quantity: 0 },
      { codigo: 'A2', quantity: -1 },
    ])).toEqual([]);
  });

  it('mantém item válido', () => {
    expect(selecionarBaixas([{ codigo: '02835002RS', quantity: 3 }]))
      .toEqual([{ codigo: '02835002RS', quantity: 3 }]);
  });

  it('agrega o mesmo sku repetido no mesmo pedido', () => {
    expect(selecionarBaixas([
      { codigo: 'A1', quantity: 1 },
      { codigo: 'A1', quantity: 2 },
    ])).toEqual([{ codigo: 'A1', quantity: 3 }]);
  });

  it('preserva a ordem de primeira aparição', () => {
    expect(selecionarBaixas([
      { codigo: 'B', quantity: 1 },
      { codigo: 'A', quantity: 1 },
      { codigo: 'B', quantity: 1 },
    ])).toEqual([{ codigo: 'B', quantity: 2 }, { codigo: 'A', quantity: 1 }]);
  });

  it('lista vazia devolve vazio', () => {
    expect(selecionarBaixas([])).toEqual([]);
  });
});

describe('refBaixa', () => {
  it('é canal-agnóstica por construção — o canal entra na chave', () => {
    expect(refBaixa('mercado_livre', 123, 'A1')).toBe('mercado_livre:123:A1');
    expect(refBaixa('shopee', 123, 'A1')).toBe('shopee:123:A1');
  });

  it('aceita orderId string ou número sem mudar a chave', () => {
    expect(refBaixa('mercado_livre', '123', 'A1')).toBe(refBaixa('mercado_livre', 123, 'A1'));
  });
});
