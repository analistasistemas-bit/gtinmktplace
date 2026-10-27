import { describe, it, expect } from 'vitest';
import { categoriaAceitaCor, removerCorDoSlot, removerCorDosSlots, removerSecaoCores } from '../sem-atributo';
import { posProcessarDescricao } from '../../ai/copywriter-prompt';
import type { AtributoSchema } from '../../categoria/schema';

const attr = (id: string): AtributoSchema => ({
  id, nome: id, required: false, conditionalRequired: false, valueType: 'string',
  valores: [], allowedUnits: [], tags: [],
});

describe('categoriaAceitaCor', () => {
  it('categoria com COLOR ou MAIN_COLOR aceita cor', () => {
    expect(categoriaAceitaCor([attr('BRAND'), attr('COLOR')])).toBe(true);
    expect(categoriaAceitaCor([attr('MAIN_COLOR')])).toBe(true);
  });

  it('categoria sem atributo de cor (ex.: MLB1265 Shampoos) não aceita', () => {
    expect(categoriaAceitaCor([attr('BRAND'), attr('TOTAL_CONTENT_VOLUME')])).toBe(false);
  });

  it('schema vazio = não lido → mantém o comportamento atual (aceita)', () => {
    expect(categoriaAceitaCor([])).toBe(true);
  });
});

describe('removerCorDoSlot', () => {
  it('remove a cor como palavra inteira, sem acento/caixa', () => {
    expect(removerCorDoSlot('Preto', ['Preto'])).toBe('');
    expect(removerCorDoSlot('Grande PRETO', ['Preto'])).toBe('Grande');
    expect(removerCorDoSlot('Azul Marinho 2', ['azul marinho'])).toBe('2');
    expect(removerCorDoSlot('Pêssego', ['Pessego'])).toBe('');
  });

  it('não corta parte de palavra', () => {
    expect(removerCorDoSlot('Pretoria', ['Preto'])).toBe('Pretoria');
  });
});

describe('removerCorDosSlots', () => {
  it('tira a cor de todos os slots, não só de variacao (revisão Codex)', () => {
    const slots = { produto: 'Shampoo', modelo: 'Preto', variacao: 'Preto', marca: 'Hair Fly' };
    expect(removerCorDosSlots(slots, ['Preto'], 'Shampoo HIDRATA MUITO MAIS 2000ml'))
      .toEqual({ produto: 'Shampoo', modelo: '', variacao: '', marca: 'Hair Fly' });
  });

  it('mantém a cor que está escrita na fonte (nome/descrição)', () => {
    const slots = { produto: 'Shampoo Matizador Preto', variacao: 'Preto' };
    expect(removerCorDosSlots(slots, ['Preto'], 'SHAMPOO MATIZADOR PRETO 1L')).toEqual(slots);
  });
});

describe('removerSecaoCores', () => {
  it('tira a seção de cores e a ressalva de tonalidade, mantendo o resto', () => {
    const desc = [
      '📌 ESPECIFICAÇÕES', '', '• Volume: 2000ml', '',
      '🎨 CORES DISPONÍVEIS', '', '- Preto', '',
      'A tonalidade pode variar conforme a tela do dispositivo.', '',
      '📦 O QUE VOCÊ RECEBE', '', '• 1 unidade',
    ].join('\n');
    const out = removerSecaoCores(desc);
    expect(out).not.toMatch(/CORES DISPON|Preto|tonalidade/);
    expect(out).toContain('• Volume: 2000ml');
    expect(out).toContain('📦 O QUE VOCÊ RECEBE');
  });

  // Revisão Codex: posProcessarDescricao sozinho mantinha a seção com cor 'Outra'.
  it('cadeia real: seção que a IA escreveu com a cor da foto some depois do pós-processamento', () => {
    const desc = '📌 ESPECIFICAÇÕES\n\n• Volume: 2000ml\n\n🎨 CORES DISPONÍVEIS\n\n- Preto\n\n📦 O QUE VOCÊ RECEBE\n\n• 1 unidade';
    const vars = [{ codigo: '00139220', cor: 'Outra', preco: 36.02, nome: 'SHAMPOO' }];
    const out = posProcessarDescricao(removerSecaoCores(desc), 'SHAMPOO', '', vars);
    expect(out).not.toMatch(/CORES DISPON|Preto|tonalidade/);
  });

  it('sem seção de cores devolve o texto intacto', () => {
    expect(removerSecaoCores('📌 ESPECIFICAÇÕES\n\n• Volume: 2000ml')).toBe('📌 ESPECIFICAÇÕES\n\n• Volume: 2000ml');
  });
});
