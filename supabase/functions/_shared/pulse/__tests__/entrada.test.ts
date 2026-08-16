import { describe, it, expect } from 'vitest';
import { resolverEntrada } from '../entrada.ts';

describe('resolverEntrada', () => {
  it('URL de catálogo com /p/ → cpid', () => {
    expect(resolverEntrada('https://www.mercadolivre.com.br/p/MLB123456')).toEqual({ tipo: 'cpid', valor: 'MLB123456' });
  });

  it('GTIN de 13 dígitos → gtin', () => {
    expect(resolverEntrada('7891113108010')).toEqual({ tipo: 'gtin', valor: '7891113108010' });
  });

  it('URL de item avulso de terceiro (sem /p/) → invalida', () => {
    expect(resolverEntrada('https://produto.mercadolivre.com.br/MLB-123456789-nome-do-produto-_JM')).toEqual({ tipo: 'invalida', valor: null });
  });

  it('texto qualquer → invalida', () => {
    expect(resolverEntrada('não sei o que é isso')).toEqual({ tipo: 'invalida', valor: null });
  });
});
