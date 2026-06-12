import { describe, it, expect } from 'vitest';
import { parseCategoriaProduto } from '../produto-categoria';

describe('parseCategoriaProduto', () => {
  it('extrai category_id do produto de catálogo', () => {
    expect(parseCategoriaProduto({ id: 'MLB123', category_id: 'MLB255054' })).toBe('MLB255054');
  });
  it('null quando ausente ou vazio', () => {
    expect(parseCategoriaProduto({ id: 'MLB123' })).toBeNull();
    expect(parseCategoriaProduto({ category_id: '' })).toBeNull();
    expect(parseCategoriaProduto(null)).toBeNull();
  });
});
