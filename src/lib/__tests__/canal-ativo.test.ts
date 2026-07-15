import { describe, it, expect } from 'vitest';
import { parseCanalAtivo } from '@/lib/canal-ativo';

describe('parseCanalAtivo', () => {
  const operaveis = ['mercado_livre'];
  it('aceita canal operável', () => {
    expect(parseCanalAtivo('mercado_livre', operaveis)).toBe('mercado_livre');
  });
  it('lixo, canal não-operável ou ausente → todos (fallback silencioso)', () => {
    expect(parseCanalAtivo(null, operaveis)).toBe('todos');
    expect(parseCanalAtivo('xpto', operaveis)).toBe('todos');
    expect(parseCanalAtivo('shopee', operaveis)).toBe('todos'); // em_breve não filtra dados
    expect(parseCanalAtivo('todos', operaveis)).toBe('todos');
  });
});
