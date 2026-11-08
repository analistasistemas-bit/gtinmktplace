import { describe, expect, it } from 'vitest';
import {
  LIMITE_TITULO_KIT, montarUserPromptKit, posProcessarDescricaoKit, posProcessarTituloKit,
} from '../../_shared/ai/copywriter-kit-prompt.ts';
import { ehFamiliaDeKit } from '../../_shared/kit-variacao/familia-kit.ts';

describe('posProcessarTituloKit', () => {
  it('começa em "Kit N"', () => {
    expect(posProcessarTituloKit('Blusa Feminina Algodão', 4)).toBe('Kit 4 Blusa Feminina Algodão');
  });
  it('não duplica o "Kit" que o modelo já pôs', () => {
    expect(posProcessarTituloKit('Kit 4 Blusa Feminina', 4)).toBe('Kit 4 Blusa Feminina');
    expect(posProcessarTituloKit('Kit com 3 Peças: Blusa Feminina', 4)).toBe('Kit 4 Blusa Feminina');
    expect(posProcessarTituloKit('Kit de Blusas', 2)).toBe('Kit 2 Blusas');
  });
  it('respeita o limite de 60 sem cortar palavra', () => {
    const t = posProcessarTituloKit('Blusa Feminina Manga Curta Algodão Premium Confortável Básica Casual Verão', 6);
    expect(t.length).toBeLessThanOrEqual(LIMITE_TITULO_KIT);
    expect(t.startsWith('Kit 6 Blusa')).toBe(true);
    expect(t.endsWith(' ')).toBe(false);
    expect('Kit 6 Blusa Feminina Manga Curta Algodão Premium Confortável Básica Casual Verão').toContain(t);
  });
  it('título vazio do modelo ainda traz "Kit N"', () => {
    expect(posProcessarTituloKit('', 3)).toBe('Kit 3');
  });
});

describe('posProcessarDescricaoKit', () => {
  it('acrescenta a abertura quando o modelo não disse que é kit de N peças', () => {
    expect(posProcessarDescricaoKit('Blusa macia.', 4)).toBe('Kit com 4 peças.\n\nBlusa macia.');
  });
  it('mantém quando já diz', () => {
    const d = 'Este kit traz 4 peças em cores combinadas.';
    expect(posProcessarDescricaoKit(d, 4)).toBe(d);
  });
});

describe('montarUserPromptKit', () => {
  it('leva peças e cores', () => {
    const p = montarUserPromptKit({ nome: 'Blusa', descricao: 'Algodão', pecas: 4, cores: ['Azul', 'Rosa'] });
    expect(p).toContain('Peças por kit: 4');
    expect(p).toContain('Azul, Rosa');
  });
});

describe('ehFamiliaDeKit (trava de process-familia)', () => {
  it('kit vinculado e kit com variação são kit; família comum não', () => {
    expect(ehFamiliaDeKit({ kit_multiplicador: 3, kit_variacao_pedido: null })).toBe(true);
    expect(ehFamiliaDeKit({ kit_multiplicador: null, kit_variacao_pedido: 'abc' })).toBe(true);
    expect(ehFamiliaDeKit({ kit_multiplicador: null, kit_variacao_pedido: null })).toBe(false);
  });
});
