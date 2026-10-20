import { describe, it, expect } from 'vitest';
import {
  atualizarSecaoTamanhos,
  linhaTamanhos,
  montarUserPrompt,
  posProcessarDescricao,
  removerPerguntasIncompletas,
  tamanhosDaGradeCopy,
} from '../copywriter-prompt';

// ADR-0183 — fixtures reais: Conjunto 00000043 (Estampa × 2/4/6/8, infantil) e Short 00000010
// (cores × P–GG, grade_tamanho null). No cadastro em grade `nome == cor`.
const CONJUNTO = 'Conjunto Infantil Proteção Solar UV';
const variacoesConjunto = ['Estampa 1', 'Estampa 2', 'Estampa 3'].flatMap((cor, i) =>
  ['8', '2', '6', '4'].map((tamanho, j) => ({
    codigo: `${i}${j}`, cor, nome: cor, preco: 59.9, tamanho, excluida_da_publicacao: false,
  }))
);
const variacoesShort = ['Cinza', 'Amarelo'].flatMap((cor) =>
  ['GG', 'P', 'M', 'G'].map((tamanho) => ({ codigo: cor + tamanho, cor, nome: cor, preco: 89, tamanho }))
);

const DESCRICAO_IA = [
  '🧵 CONJUNTO INFANTIL COM PROTEÇÃO UV',
  '',
  'Parágrafo um.',
  '',
  '✅ POR QUE ESCOLHER',
  '',
  '✔ Proteção UV 50+',
  '✔ Comprimento de 40 cm na blusa',
  '',
  '📌 ESPECIFICAÇÕES',
  '',
  '• Composição: 85% Poliamida 15% Elastano',
  '• Proteção: FPU 50+',
  '• Tamanho: 2 a 8 anos',
  '• Comprimento: 40 cms',
  '',
  '🎯 INDICAÇÕES DE USO',
  '',
  '✔ Praia',
  '✔ Piscina',
  '',
  '❓ PERGUNTAS SOBRE ESTE PRODUTO',
  '',
  '▪ Qual a composição? 85% Poliamida 15% Elastano.',
  '▪ Qual a medida da blusa? 40 centimetros.',
  '▪ Tem proteção UV? Sim, FPU 50+.',
  '',
  '🎨 ESTAMPAS DISPONÍVEIS',
  '',
  '- Estampa 1',
  '- Estampa 2',
  '- Estampa 3',
  '',
  '📦 O QUE VOCÊ RECEBE',
  '',
  '• 1 conjunto',
  '',
  'Garanta o conjunto e aproveite o sol com proteção.',
].join('\n');

describe('tamanhosDaGradeCopy (ADR-0183)', () => {
  it('grade infantil → tamanhos distintos em ordem numérica', () => {
    expect(tamanhosDaGradeCopy(variacoesConjunto)).toEqual(['2', '4', '6', '8']);
  });
  it('letras → ordem P, M, G, GG', () => {
    expect(tamanhosDaGradeCopy(variacoesShort)).toEqual(['P', 'M', 'G', 'GG']);
  });
  it('sem tamanho (simples, kit, partição) → null', () => {
    expect(tamanhosDaGradeCopy([{ codigo: '1', cor: 'Azul', preco: 1 }])).toBeNull();
  });
  it('mista → null', () => {
    expect(tamanhosDaGradeCopy([
      { codigo: '1', cor: 'Azul', preco: 1, tamanho: 'P' },
      { codigo: '2', cor: 'Azul', preco: 1, tamanho: null },
    ])).toBeNull();
  });
  it('excluída da publicação não conta', () => {
    expect(tamanhosDaGradeCopy([
      { codigo: '1', cor: 'Azul', preco: 1, tamanho: 'P' },
      { codigo: '2', cor: 'Azul', preco: 1, tamanho: 'G', excluida_da_publicacao: true },
    ])).toEqual(['P']);
  });
});

describe('linhaTamanhos', () => {
  it('infantil ganha "anos"', () => {
    expect(linhaTamanhos(['2', '4', '6', '8'])).toBe('Tamanhos disponíveis: 2, 4, 6 e 8 anos.');
  });
  it('letras sem sufixo; tamanho único sem "e"', () => {
    expect(linhaTamanhos(['P', 'M', 'G', 'GG'])).toBe('Tamanhos disponíveis: P, M, G e GG.');
    expect(linhaTamanhos(['M'])).toBe('Tamanhos disponíveis: M.');
  });
});

describe('posProcessarDescricao em grade (ADR-0183)', () => {
  const out = posProcessarDescricao(DESCRICAO_IA, CONJUNTO, 'Conjunto com proteção UV 50+.', variacoesConjunto);

  it('remove 🎯 e 📦 mas preserva a frase de fechamento', () => {
    expect(out).not.toContain('🎯');
    expect(out).not.toContain('Piscina');
    expect(out).not.toContain('📦');
    expect(out).not.toContain('1 conjunto');
    expect(out.trimEnd().endsWith('Garanta o conjunto e aproveite o sol com proteção.')).toBe(true);
  });

  it('injeta 📏 entre 📌 e ❓ com os tamanhos e o aviso das fotos', () => {
    expect(out).toContain('📏 GUIA DE TAMANHOS');
    expect(out).toContain('Tamanhos disponíveis: 2, 4, 6 e 8 anos.');
    expect(out).toContain('Confira nas fotos as medidas em centímetros de cada peça antes de escolher o tamanho.');
    expect(out.indexOf('📌')).toBeLessThan(out.indexOf('📏'));
    expect(out.indexOf('📏')).toBeLessThan(out.indexOf('❓'));
    expect(out.match(/📏/g)).toHaveLength(1);
  });

  it('nenhum bullet com medida sobrevive; rótulo Tamanho sai; prosa e percentuais ficam', () => {
    expect(out).not.toMatch(/40 cm/);
    expect(out).not.toContain('Comprimento');
    expect(out).not.toContain('• Tamanho');
    expect(out).toContain('85% Poliamida');
    expect(out).toContain('Parágrafo um.');
  });

  it('pergunta fixa de tamanho entra uma vez e conta no mínimo de 3', () => {
    expect(out.match(/Como escolher o tamanho\?/g)).toHaveLength(1);
    expect(out).toContain('▪ Tem proteção UV? Sim, FPU 50+.');
  });

  it('idempotente', () => {
    expect(posProcessarDescricao(out, CONJUNTO, '', variacoesConjunto)).toBe(out);
  });

  it('seção ❓ ausente: 2 specs mapeáveis + fixa reconstroem a seção', () => {
    const semPerguntas = [
      '🧵 SHORT', '', 'Texto.', '', '📌 ESPECIFICAÇÕES', '', '• Composição: Linho', '• Marca: Mauricinho',
      '', '🎨 CORES DISPONÍVEIS', '', '- Amarelo', '- Cinza', '', 'Escolha o seu.',
    ].join('\n');
    const r = posProcessarDescricao(semPerguntas, 'Short Linho', '', variacoesShort);
    expect(r).toContain('❓ PERGUNTAS SOBRE ESTE PRODUTO');
    expect(r).toContain('▪ Qual a composição? Linho.');
    expect(r).toContain('Como escolher o tamanho?');
    expect(r).toContain('Tamanhos disponíveis: P, M, G e GG.');
    expect(r.indexOf('📏')).toBeLessThan(r.indexOf('❓'));
  });

  it('📏 escrito pela IA é substituído pelo do sistema', () => {
    const comGuiaIA = DESCRICAO_IA.replace('🎯 INDICAÇÕES DE USO', '📏 GUIA DE TAMANHOS\n\n- 2 anos: 50 cm\n\n🎯 INDICAÇÕES DE USO');
    const r = posProcessarDescricao(comGuiaIA, CONJUNTO, '', variacoesConjunto);
    expect(r.match(/📏/g)).toHaveLength(1);
    expect(r).not.toContain('50 cm');
  });

  it('📏 da IA em prosa no meio do template sai inteiro, fechamento preservado, idempotente', () => {
    const comGuiaProsa = DESCRICAO_IA.replace(
      '🎯 INDICAÇÕES DE USO',
      '📏 GUIA DE TAMANHOS\n\nO tamanho 2 anos veste crianças de 50 cm de quadril.\n\n🎯 INDICAÇÕES DE USO',
    );
    const r = posProcessarDescricao(comGuiaProsa, CONJUNTO, '', variacoesConjunto);
    expect(r).not.toContain('50 cm');
    expect(r.match(/Tamanhos disponíveis/g)).toHaveLength(1);
    expect(r.trimEnd().endsWith('Garanta o conjunto e aproveite o sol com proteção.')).toBe(true);
    expect(posProcessarDescricao(r, CONJUNTO, '', variacoesConjunto)).toBe(r);
  });
});

describe('achados da revisão Grok (ADR-0183)', () => {
  const base = (specs: string[], extra: string[] = []) => [
    '🧵 CONJUNTO', '', 'Texto.', '', '✅ POR QUE ESCOLHER', '', '✔ Faixa refletiva 3M', '✔ Tamanho: 2 a 8 anos',
    '', '📌 ESPECIFICAÇÕES', '', ...specs, ...extra, '', 'Garanta o seu.',
  ].join('\n');

  it('rótulo de tamanho por prefixo em qualquer bullet sai; marca 3M e "1 máscara" ficam', () => {
    const r = posProcessarDescricao(
      base(['• Marca: 3M', '• Conteúdo: 1 máscara', '• Tamanhos disponíveis: 2 e 4', '• Composição: Poliamida']),
      CONJUNTO, '', variacoesConjunto,
    );
    expect(r).toContain('✔ Faixa refletiva 3M');
    expect(r).toContain('• Marca: 3M');
    expect(r).toContain('• Conteúdo: 1 máscara');
    expect(r).not.toContain('Tamanho: 2 a 8');
    expect(r).not.toContain('2 e 4');
    expect(r.match(/Tamanhos disponíveis/g)).toHaveLength(1);
  });

  it('pergunta de tamanho da IA sai; fica só a fixa', () => {
    const r = posProcessarDescricao(base(['• Composição: Poliamida'], [
      '', '❓ PERGUNTAS SOBRE ESTE PRODUTO', '', '▪ Qual o tamanho? Do 2 ao 8 anos.',
      '▪ Qual a composição? Poliamida.', '▪ Tem proteção UV? Sim.',
    ]), CONJUNTO, '', variacoesConjunto);
    expect(r).not.toContain('Do 2 ao 8');
    expect(r.match(/tamanho\?/gi)).toHaveLength(1);
  });

  it('❓ recriada no fim: guia fica logo após 📌, antes da frase final', () => {
    const r = posProcessarDescricao(
      base(['• Composição: Poliamida', '• Marca: Lulu', '• Modelo: Praia']), CONJUNTO, '', variacoesConjunto,
    );
    expect(r.indexOf('📏')).toBeLessThan(r.indexOf('Garanta o seu.'));
    expect(r.indexOf('📌')).toBeLessThan(r.indexOf('📏'));
  });
});

describe('caso real Conjunto Sereia (2026-10-18)', () => {
  // A IA omitiu ❓; Proteção UV/Quantidade/Aplicação não viravam pergunta → 1 + fixa = 2 < 3.
  const SEREIA = [
    '🧵 CONJUNTO INFANTIL COM PROTEÇÃO SOLAR UV SEREIA', '', 'Texto.', '',
    '📌 ESPECIFICAÇÕES', '',
    '• Composição: 90% poliamida e 10% elastano', '• Proteção UV: 30', '• Quantidade: 1 unidade', '• Aplicação: praia',
    '', '🎨 CORES DISPONÍVEIS', '', '- Estampa Sereia', '', 'Conjunto com proteção solar para dias de sol.',
  ].join('\n');
  const vs = ['4', '6', '8', '10'].map((tamanho) => ({ codigo: tamanho, cor: 'Estampa Sereia', nome: 'Estampa Sereia', preco: 1, tamanho }));

  it('reconstrói ❓ com proteção UV, quantidade e aplicação', () => {
    const r = posProcessarDescricao(SEREIA, 'Conjunto Infantil Proteção Solar UV', '', vs);
    expect(r).toContain('❓ PERGUNTAS SOBRE ESTE PRODUTO');
    expect(r).toContain('▪ Qual a composição? 90% poliamida e 10% elastano.');
    expect(r).toContain('▪ Qual o fator de proteção UV? 30.');
    expect(r).toContain('▪ Quantas unidades acompanham? 1 unidade.');
    expect(r).toContain('▪ Qual a aplicação? praia.');
    expect(r).toContain('Como escolher o tamanho?');
  });

  it('rótulo só vira pergunta quando o valor a responde (revisão Codex)', () => {
    const specs = ['📌 ESPECIFICAÇÕES', '', '• Composição: Algodão', '• Proteção UV: Sim', '• Proteção: contra corrosão',
      '• Quantidade: 10 metros', '• Marca: Lulu', '• Modelo: Praia'].join('\n');
    const r = posProcessarDescricao(specs, 'Produto', '', [{ codigo: '1', cor: null, preco: 1 }]);
    expect(r).toContain('❓ PERGUNTAS SOBRE ESTE PRODUTO');
    expect(r).not.toContain('fator de proteção');
    expect(r).not.toContain('Quantas unidades');
  });

  it('"Estampa1" (colado ao número) continua ESTAMPAS', () => {
    const v = ['Estampa1', 'Estampa2'].map((cor) => ({ codigo: cor, cor, nome: cor, preco: 1, tamanho: 'P' }));
    expect(montarUserPrompt({ nome: 'Short', descricao_detalhado: 'x', variacoes: v })).toContain('"🎨 ESTAMPAS DISPONÍVEIS"');
  });

  it('"Estampa Sereia" (sem número) → ESTAMPAS DISPONÍVEIS', () => {
    const p = montarUserPrompt({ nome: 'Conjunto', descricao_detalhado: 'x', variacoes: vs });
    expect(p).toContain('"🎨 ESTAMPAS DISPONÍVEIS"');
  });
});

// Família real 00000069 (camisa Zaven, 18/10): fonte só com composição → 1 derivada + fixa = 2,
// abaixo do mínimo; a seção ❓ (e a pergunta fixa de tamanho) sumia inteira.
describe('caso real camisa 00000069 (emenda ADR-0183, 2026-10-18)', () => {
  const variacoesCamisa = ['Azul Claro', 'Preto'].flatMap((cor) =>
    ['P', 'M', 'G', 'GG', 'GGG'].map((tamanho) => ({ codigo: cor + tamanho, cor, nome: cor, preco: 37.5, tamanho }))
  );
  const base = [
    '🧵 CAMISAS MASCULINAS DE ALGODÃO EGÍPCIO', '', 'Parágrafo.', '',
    '✅ POR QUE ESCOLHER', '', '✔ Algodão egípcio', '',
    '📌 ESPECIFICAÇÕES', '', '• Composição: 90% Algodão 10% Elastano', '',
  ];
  const cores = ['🎨 CORES DISPONÍVEIS', '', '- Azul Claro', '- Preto', '', 'A tonalidade pode variar conforme a tela do dispositivo.', ''];
  const FECHO = 'Leve a camisa que alia algodão egípcio e elastano no seu dia a dia.';

  it('1 spec + público + fixa de tamanho → ❓ com 3 perguntas; fechamento preservado', () => {
    const d = posProcessarDescricao([...base, ...cores, FECHO].join('\n'), 'Camisa', '', variacoesCamisa, 'masculino');
    const perguntas = d.split('\n').filter((l) => l.startsWith('▪'));
    expect(perguntas).toEqual([
      '▪ Qual a composição? 90% Algodão 10% Elastano.',
      '▪ Para qual público é indicado? Masculino.',
      '▪ Como escolher o tamanho? Confira nas fotos do anúncio as medidas em centímetros de cada peça.',
    ]);
    expect(d.trim().endsWith(FECHO)).toBe(true);
    expect(posProcessarDescricao(d, 'Camisa', '', variacoesCamisa, 'masculino')).toBe(d);
  });

  it('❓ incompleta depois de 🎨 é podada sem levar a frase final', () => {
    const ia = [...base, ...cores, '❓ PERGUNTAS SOBRE ESTE PRODUTO', '', '▪ Qual a composição? 90% algodão.', '', FECHO].join('\n');
    const d = posProcessarDescricao(ia, 'Camisa', '', variacoesCamisa, 'masculino');
    expect(d.trim().endsWith(FECHO)).toBe(true);
    expect(d.split('\n').filter((l) => l.startsWith('▪')).length).toBeGreaterThanOrEqual(3);
  });

  // Revisão Codex do diff (18/10).
  it('resposta na linha de baixo não é fronteira da ❓ (vale para não-grade também)', () => {
    const faq = ['📌 ESPECIFICAÇÕES', '', '• Marca: X', '', '❓ PERGUNTAS SOBRE ESTE PRODUTO', '',
      '▪ Qual a composição?', '100% Algodão.', '▪ Qual a marca?', 'X.', '▪ Qual o uso?', 'Diário.', '', FECHO].join('\n');
    expect(removerPerguntasIncompletas(faq)).toBe(faq);
  });

  it('❓ da IA que já passa do mínimo também ganha a pergunta de público, antes da de tamanho', () => {
    const ia = [...base, '❓ PERGUNTAS SOBRE ESTE PRODUTO', '', '▪ Qual a composição? 90% algodão.',
      '▪ Qual a marca? Zaven.', '', ...cores, FECHO].join('\n');
    const d = posProcessarDescricao(ia, 'Camisa', '', variacoesCamisa, 'masculino');
    const perguntas = d.split('\n').filter((l) => l.startsWith('▪'));
    expect(perguntas.slice(-2)).toEqual([
      '▪ Para qual público é indicado? Masculino.',
      '▪ Como escolher o tamanho? Confira nas fotos do anúncio as medidas em centímetros de cada peça.',
    ]);
    expect(posProcessarDescricao(d, 'Camisa', '', variacoesCamisa, 'masculino')).toBe(d);
  });

  // Reprocessamento real (18/10): a IA escreveu "Qual o público indicado? Produto masculino." e a
  // fixa entrou de novo — duas perguntas de público.
  it('❓ da IA que já pergunta o público não ganha a fixa', () => {
    const ia = [...base, '❓ PERGUNTAS SOBRE ESTE PRODUTO', '', '▪ Qual a composição? 90% algodão.', '',
      '▪ Qual o público indicado? Produto masculino.', '', '▪ Qual a marca? Zaven.', '', ...cores, FECHO].join('\n');
    const d = posProcessarDescricao(ia, 'Camisa', '', variacoesCamisa, 'masculino');
    expect(d.split('\n').filter((l) => /p[úu]blico/i.test(l))).toEqual(['▪ Qual o público indicado? Produto masculino.']);
  });

  it('sem gênero: comportamento anterior (sem pergunta de público)', () => {
    const d = posProcessarDescricao([...base, ...cores, FECHO].join('\n'), 'Camisa', '', variacoesCamisa);
    expect(d).not.toContain('Para qual público');
  });
});

describe('não-grade inalterado (ADR-0183)', () => {
  it('sem tamanho, 🎯/📦 continuam e não há 📏', () => {
    const r = posProcessarDescricao(DESCRICAO_IA, 'Fita', '', [{ codigo: '1', cor: 'Estampa 1', nome: 'Estampa 1', preco: 1 }]);
    expect(r).toContain('🎯 INDICAÇÕES DE USO');
    expect(r).toContain('📦 O QUE VOCÊ RECEBE');
    expect(r).not.toContain('📏');
    expect(r).toContain('Comprimento: 40 cms');
  });
});

describe('montarUserPrompt em grade', () => {
  it('rótulo ESTAMPAS quando toda cor é "Estampa N"; avisa grade; não lista tamanhos', () => {
    const p = montarUserPrompt({ nome: CONJUNTO, descricao_detalhado: 'x', variacoes: variacoesConjunto });
    expect(p).toContain('"🎨 ESTAMPAS DISPONÍVEIS"');
    expect(p.match(/- Estampa 1/g)).toHaveLength(1);
    expect(p).toContain('GRADE');
    expect(p).not.toContain('- 2\n');
  });
  it('cores reais → CORES DISPONÍVEIS', () => {
    const p = montarUserPrompt({ nome: 'Short', descricao_detalhado: 'x', variacoes: variacoesShort });
    expect(p).toContain('"🎨 CORES DISPONÍVEIS"');
  });
});

describe('atualizarSecaoTamanhos (UPDATE)', () => {
  const base = '📏 GUIA DE TAMANHOS\n\nTamanhos disponíveis: 2, 4 e 6 anos.\n\nConfira nas fotos.';
  it('reescreve só a linha de tamanhos e é idempotente', () => {
    const r = atualizarSecaoTamanhos(base, ['2', '4', '6', '10']);
    expect(r).toBe('📏 GUIA DE TAMANHOS\n\nTamanhos disponíveis: 2, 4, 6 e 10 anos.\n\nConfira nas fotos.');
    expect(atualizarSecaoTamanhos(r, ['2', '4', '6', '10'])).toBe(r);
  });
  it('sem a linha ou sem tamanhos → intacto', () => {
    expect(atualizarSecaoTamanhos('texto qualquer', ['P'])).toBe('texto qualquer');
    expect(atualizarSecaoTamanhos(base, [])).toBe(base);
  });
});

describe('rótulo Volume na grade (20/10)', () => {
  it('• Metragem: 500ml vira • Volume: 500ml também no caminho de grade', () => {
    const d = [
      '🧵 CONJUNTO', '', 'Texto.', '', '📌 ESPECIFICAÇÕES', '', '• Marca: Mauricinho', '• Metragem: 500ml',
      '', 'Garanta o seu.',
    ].join('\n');
    const r = posProcessarDescricao(d, CONJUNTO, '', variacoesConjunto);
    expect(r).toContain('• Volume: 500ml');
    expect(r).not.toMatch(/Metragem/i);
  });
});
