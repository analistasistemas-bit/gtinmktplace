import { describe, expect, it } from 'vitest';
import { formatoPublicacaoMlFromRow } from '@/lib/queries';

describe('formatoPublicacaoMlFromRow', () => {
  it('mapeia a propriedade sintética User Products', () => {
    expect(formatoPublicacaoMlFromRow({ formato_publicacao_ml: 'user_products' })).toBe('user_products');
  });

  it('mantém desconhecido quando a propriedade sintética não existe', () => {
    expect(formatoPublicacaoMlFromRow({})).toBeNull();
  });
});
