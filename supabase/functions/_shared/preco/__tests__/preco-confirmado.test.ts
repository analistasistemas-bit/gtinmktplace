import { describe, expect, it } from 'vitest';
import { precoAConfirmar } from '../preco-confirmado.ts';

describe('precoAConfirmar', () => {
  it('em somenteEstoque o preco confirmado das existentes e o vivo; tudo empurra o novo', () => {
    expect(precoAConfirmar({ somenteEstoque: true, precoVivo: 25, precoEnviado: 30 })).toBe(25);
    expect(precoAConfirmar({ somenteEstoque: false, precoVivo: 25, precoEnviado: 30 })).toBe(30);
  });

  it('somenteEstoque sem preco vivo → null (nada a confirmar, badge nao mente)', () => {
    expect(precoAConfirmar({ somenteEstoque: true, precoVivo: null, precoEnviado: 30 })).toBeNull();
  });

  it('atualizar tudo sem preco enviado cai no vivo', () => {
    expect(precoAConfirmar({ somenteEstoque: false, precoVivo: 25, precoEnviado: null })).toBe(25);
    expect(precoAConfirmar({ somenteEstoque: false, precoVivo: null, precoEnviado: null })).toBeNull();
  });
});
