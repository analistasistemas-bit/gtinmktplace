import { describe, it, expect } from 'vitest';
import { CATEGORIAS_NOTIFICACAO, CATEGORIA_LABEL } from '../notificacoes-categorias';
import { CATEGORIAS_NOTIFICACAO as CATEGORIAS_DENO } from '../../../supabase/functions/_shared/notificacoes/categorias.ts';

describe('categorias de notificação', () => {
  it('front e Deno em sincronia', () => {
    expect([...CATEGORIAS_NOTIFICACAO]).toEqual([...CATEGORIAS_DENO]);
  });
  it('tem reposicao (ADR-0207)', () => {
    expect(CATEGORIAS_NOTIFICACAO).toContain('reposicao');
    expect((CATEGORIA_LABEL as Record<string, string>).reposicao).toBe('Reposição');
  });
});
