import { describe, it, expect } from 'vitest';
import { validarTipoProdutoBusca } from '../copywriter-prompt';

describe('validarTipoProdutoBusca (regra anti-invenção, espelha ADR-0052)', () => {
  it('aceita quando a palavra aparece na descrição', () => {
    const r = validarTipoProdutoBusca('barbante de crochê', 'EUROROMA 4/6 CORES 600G 610MT', 'BARBANTE 4/6. O BARBANTE EUROROMA...');
    expect(r).toBe('barbante de crochê');
  });

  it('aceita quando a palavra aparece no nome', () => {
    const r = validarTipoProdutoBusca('bainha instantânea', 'BAINHA INSTANTÂNEA 4MT UND', '');
    expect(r).toBe('bainha instantânea');
  });

  it('rejeita (string vazia) quando nenhuma palavra significativa consta na fonte', () => {
    const r = validarTipoProdutoBusca('solda de estanho', 'EUROROMA 4/6 CORES 600G 610MT', 'BARBANTE 4/6...');
    expect(r).toBe('');
  });

  it('ignora acento/caixa na comparação', () => {
    const r = validarTipoProdutoBusca('Bainha Instantânea', 'bainha instantanea 4mt und', '');
    expect(r).toBe('Bainha Instantânea');
  });

  it('string vazia/whitespace → vazia', () => {
    expect(validarTipoProdutoBusca('', 'X', 'Y')).toBe('');
    expect(validarTipoProdutoBusca('   ', 'X', 'Y')).toBe('');
  });

  it('BUG a evitar: tipo composto só de palavras curtas (<3 letras) NÃO auto-aceita — rejeita', () => {
    const r = validarTipoProdutoBusca('e a', 'EUROROMA 4/6 CORES 600G 610MT', 'BARBANTE 4/6...');
    expect(r).toBe('');
  });

  it('palavra curta real de produto (3 letras) conta como grounded', () => {
    const r = validarTipoProdutoBusca('fio de bordar', 'NOVELO X', 'PRODUTO FEITO DE FIO 100% ALGODAO');
    expect(r).toBe('fio de bordar');
  });
});
