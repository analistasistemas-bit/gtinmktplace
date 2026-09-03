import { describe, it, expect } from 'vitest';
import { linhaVendaAcimaSaldo, linhaDesyncMl } from '../estoque-kit.ts';

it('venda de kit acima do saldo nomeia o kit e as duas unidades', () => {
  const linha = linhaVendaAcimaSaldo({
    codigo: '00000021', pedido: 9, anterior: 4, aplicado: 4,
    kitCodigoPai: '00000020', multiplicador: 3,
  });
  // O operador vê 3 kits no pedido do ML e 9 unidades saindo do saldo da base.
  expect(linha.includes('3 kit(s) de 3 un.')).toEqual(true);
  expect(linha.includes('9 un. do produto-base')).toEqual(true);
  expect(linha.includes('00000021')).toEqual(true);
});

it('venda direta acima do saldo mantém exatamente o texto de hoje', () => {
  const linha = linhaVendaAcimaSaldo({
    codigo: '00000011', pedido: 9, anterior: 4, aplicado: 4,
    kitCodigoPai: null, multiplicador: 1,
  });
  expect(linha).toEqual('• 00000011 — pedido de 9 un., havia 4, baixou 4');
});

describe('linhaDesyncMl — mesma tradução de kit no alerta de desync ML', () => {
  it('venda de kit desync nomeia o kit e as duas unidades', () => {
    const linha = linhaDesyncMl({
      codigo: '00000021', pedido: 9, kitCodigoPai: '00000020', multiplicador: 3,
    });
    expect(linha.includes('3 kit(s) de 3 un.')).toEqual(true);
    expect(linha.includes('9 un. do produto-base')).toEqual(true);
    expect(linha.includes('00000021')).toEqual(true);
  });

  it('venda direta desync mantém exatamente o texto de hoje', () => {
    const linha = linhaDesyncMl({
      codigo: '00000011', pedido: 9, kitCodigoPai: null, multiplicador: 1,
    });
    expect(linha).toEqual('• 00000011 — pedido de 9 un.');
  });
});
