import { describe, expect, it } from 'vitest';
import { podeAlterarDescontoVisual } from '@/lib/desconto';

describe('podeAlterarDescontoVisual', () => {
  it.each([
    ['Legacy', 'legacy', false, true],
    ['formato desconhecido', null, false, true],
    ['nova ativação em User Products', 'user_products', false, false],
    ['desativação de configuração antiga em User Products', 'user_products', true, true],
  ] as const)('%s', (_cenario, formato, atualmenteAtivo, esperado) => {
    expect(podeAlterarDescontoVisual(formato, atualmenteAtivo)).toBe(esperado);
  });
});
