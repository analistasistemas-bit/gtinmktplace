import { describe, it, expect } from 'vitest';
import { categoriaAceitaCor, removerCorDoSlot, removerCorDosSlots, removerCorDaDescricao } from '../sem-atributo';
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

  // Revisão Codex: separar só por espaço deixava a cor colada em pontuação.
  it('cor colada em pontuação também sai, sem sobrar pontuação pendurada', () => {
    expect(removerCorDoSlot('(Preto)', ['Preto'])).toBe('');
    expect(removerCorDoSlot('Preto, 2000ml', ['Preto'])).toBe('2000ml');
    expect(removerCorDoSlot('Preto/Branco', ['Preto'])).toBe('Branco');
    expect(removerCorDoSlot('Grande (Preto)', ['Preto'])).toBe('Grande');
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

describe('removerCorDaDescricao', () => {
  const desc = (itens: string[]) => [
    '📌 ESPECIFICAÇÕES', '', '• Volume: 2000ml', '',
    '🎨 CORES DISPONÍVEIS', '', ...itens, '',
    'A tonalidade pode variar conforme a tela do dispositivo.', '',
    '📦 O QUE VOCÊ RECEBE', '', '• 1 unidade',
  ].join('\n');

  it('única cor descartada: some a seção inteira (com a ressalva), o resto fica', () => {
    const out = removerCorDaDescricao(desc(['- Preto']), ['Preto'], '');
    expect(out).not.toMatch(/CORES DISPON|Preto|tonalidade/);
    expect(out).toContain('• Volume: 2000ml');
    expect(out).toContain('📦 O QUE VOCÊ RECEBE');
  });

  // Revisão Codex: atualizarSecaoCores só reconhecia itens com "-".
  it('item com outro marcador (• / ✔) também sai', () => {
    expect(removerCorDaDescricao(desc(['• Preto']), ['Preto'], '')).not.toMatch(/Preto|CORES DISPON/);
    expect(removerCorDaDescricao(desc(['✔ Preto']), ['Preto'], '')).not.toMatch(/Preto|CORES DISPON/);
  });

  // Revisão Codex: família com cor da foto + cor legítima perdia a lista toda.
  it('preserva as cores que não foram descartadas', () => {
    const out = removerCorDaDescricao(desc(['- Azul', '- Preto']), ['Preto'], '');
    expect(out).toContain('🎨 CORES DISPONÍVEIS');
    expect(out).toContain('- Azul');
    expect(out).not.toContain('Preto');
  });

  it('cadeia real: seção que a IA escreveu com a cor da foto some depois do pós-processamento', () => {
    const vars = [{ codigo: '00139220', cor: 'Outra', preco: 36.02, nome: 'SHAMPOO' }];
    const out = posProcessarDescricao(removerCorDaDescricao(desc(['- Preto']), ['Preto'], ''), 'SHAMPOO', '', vars);
    expect(out).not.toMatch(/CORES DISPON|Preto|tonalidade/);
  });

  // Lote Hairfly 27/10: a IA escreveu a cor também em prosa, fora da seção.
  it('tira "na cor X" / "cor: X" / "(X)" da prosa', () => {
    const real = '• 1 unidade com 2000ml do Shampoo e Condicionador Hidrata Muito Mais Hair Fly na cor Preto';
    expect(removerCorDaDescricao(real, ['Preto'], ''))
      .toBe('• 1 unidade com 2000ml do Shampoo e Condicionador Hidrata Muito Mais Hair Fly');
    expect(removerCorDaDescricao('• Cor: Preto\n• Volume: 2l', ['Preto'], '')).toBe('• Volume: 2l');
    expect(removerCorDaDescricao('Frasco de 2l, cor preto, com válvula.', ['Preto'], '')).toBe('Frasco de 2l, com válvula.');
    expect(removerCorDaDescricao('Shampoo (Preto) de 2l.', ['Preto'], '')).toBe('Shampoo de 2l.');
  });

  it('não mexe em "cor" sem a cor descartada nem em outra cor', () => {
    const t = 'Protege a cor de cabelos tingidos e realça cores vibrantes. Tampa azul.';
    expect(removerCorDaDescricao(t, ['Preto'], '')).toBe(t);
  });

  // Revisão Codex: "Mantém a cor Preto Natural" virava "Mantém a Natural".
  it('cor escrita na planilha fica na prosa', () => {
    const t = 'Mantém a cor Preto Natural dos cabelos.';
    expect(removerCorDaDescricao(t, ['Preto'], 'Tonalizante Preto Natural 1L')).toBe(t);
  });

  it('sem seção de cores devolve o texto intacto', () => {
    expect(removerCorDaDescricao('📌 ESPECIFICAÇÕES\n\n• Volume: 2000ml', ['Preto'], '')).toBe('📌 ESPECIFICAÇÕES\n\n• Volume: 2000ml');
  });
});
