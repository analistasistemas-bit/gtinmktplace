import { describe, expect, it } from 'vitest';
import { TIPOS_PRODUTO } from '@/lib/tipos-produto';

describe('TIPOS_PRODUTO', () => {
  it('tem exatamente roupa e calcado, nesta ordem', () => {
    expect(TIPOS_PRODUTO.map((t) => t.id)).toEqual(['roupa', 'calcado']);
  });

  it('o id de calcado nao tem cedilha (vai para o banco), mas o rotulo tem', () => {
    const calcado = TIPOS_PRODUTO.find((t) => t.id === 'calcado')!;
    expect(calcado.id).toBe('calcado');
    expect(calcado.nome).toBe('Calçado');
  });

  it('todo tipo tem descricao nao vazia (a tela explica o que o checkbox faz)', () => {
    for (const t of TIPOS_PRODUTO) expect(t.descricao.length).toBeGreaterThan(10);
  });
});
