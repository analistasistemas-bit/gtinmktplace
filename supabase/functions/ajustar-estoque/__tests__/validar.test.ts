import { describe, it, expect } from 'vitest';
import { refDoItem, validarAjustes } from '../validar.ts';

describe('refDoItem', () => {
  it('gera uma referência por item — nunca a mesma para dois códigos', () => {
    expect(refDoItem('abc', '18760903')).toBe('ajuste:abc:18760903');
    expect(refDoItem('abc', '26706073')).not.toBe(refDoItem('abc', '18760903'));
  });
});

describe('validarAjustes', () => {
  it('aceita lista válida', () => {
    const r = validarAjustes([{ codigo: '18760903', novoSaldo: 0 }, { codigo: '26706073', novoSaldo: 12 }]);
    expect(r).toEqual({
      ok: true,
      itens: [{ codigo: '18760903', novoSaldo: 0 }, { codigo: '26706073', novoSaldo: 12 }],
    });
  });

  it('recusa lista vazia', () => {
    expect(validarAjustes([])).toEqual({ ok: false, erro: 'Informe ao menos um SKU.' });
  });

  it('recusa o que não é lista', () => {
    expect(validarAjustes({ codigo: 'x', novoSaldo: 0 })).toEqual({ ok: false, erro: 'Informe ao menos um SKU.' });
  });

  it('recusa saldo negativo', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: -1 }]))
      .toEqual({ ok: false, erro: 'Saldo de x inválido: deve ser inteiro entre 0 e 99999.' });
  });

  it('recusa saldo acima do teto do canal', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: 100000 }]))
      .toEqual({ ok: false, erro: 'Saldo de x inválido: deve ser inteiro entre 0 e 99999.' });
  });

  it('recusa saldo fracionário', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: 1.5 }]))
      .toEqual({ ok: false, erro: 'Saldo de x inválido: deve ser inteiro entre 0 e 99999.' });
  });

  it('recusa código vazio', () => {
    expect(validarAjustes([{ codigo: '  ', novoSaldo: 0 }]))
      .toEqual({ ok: false, erro: 'Item sem SKU na lista de ajustes.' });
  });

  // O código repetido colidiria na referência de idempotência (ajuste:{ref}:{codigo}) e a
  // segunda ocorrência voltaria como "duplicada" sem ser aplicada — falha silenciosa.
  it('recusa código repetido em vez de deduplicar em silêncio', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: 0 }, { codigo: 'x', novoSaldo: 3 }]))
      .toEqual({ ok: false, erro: 'SKU repetido na lista: x.' });
  });

  it('normaliza espaços em volta do código', () => {
    expect(validarAjustes([{ codigo: ' 18760903 ', novoSaldo: 0 }]))
      .toEqual({ ok: true, itens: [{ codigo: '18760903', novoSaldo: 0 }] });
  });
});
