import { describe, it, expect } from 'vitest';
import { garantirPerguntas, posProcessarDescricao } from '../copywriter-prompt';

const ESPECIFICACOES = [
  '📌 ESPECIFICAÇÕES',
  '',
  '• Composição: 100% Poliéster',
  '• Gramatura: 145g/m²',
  '• Largura: 1,50 metros',
  '• Comprimento: 10 metros',
].join('\n');

describe('garantirPerguntas (ADR-0115)', () => {
  it('seção ausente + 4 bullets mapeáveis → reconstrói com pergunta e resposta do mesmo bullet', () => {
    const out = garantirPerguntas(`🧵 INTRO\n\nTexto.\n\n${ESPECIFICACOES}`);
    expect(out).toContain('❓ PERGUNTAS SOBRE ESTE PRODUTO');
    expect(out).toContain('▪ Qual a composição? 100% Poliéster.');
    expect(out).toContain('▪ Qual a gramatura? 145g/m².');
    expect(out).toContain('▪ Quantos metros possui? 10 metros.');
  });

  it('insere ANTES da seção de variação, na posição do template', () => {
    const out = garantirPerguntas(`${ESPECIFICACOES}\n\n🎨 ESTAMPAS DISPONÍVEIS\n\n- Estampa 6`);
    expect(out.indexOf('❓')).toBeLessThan(out.indexOf('🎨'));
  });

  it('não duplica quando a IA já escreveu a seção', () => {
    const original = `${ESPECIFICACOES}\n\n❓ PERGUNTAS SOBRE ESTE PRODUTO\n\n▪ Já existe? Sim.`;
    expect(garantirPerguntas(original)).toBe(original);
  });

  it('menos de três bullets mapeáveis → não inventa a seção', () => {
    const out = garantirPerguntas('📌 ESPECIFICAÇÕES\n\n• Composição: Algodão\n• Gramatura: 100g/m²');
    expect(out).not.toContain('❓');
  });

  it('rótulo fora da lista fechada é ignorado — não vira pergunta genérica', () => {
    const out = garantirPerguntas([
      '📌 ESPECIFICAÇÕES', '', '• Composição: Algodão', '• Gramatura: 100g/m²', '• Vibe: Boa',
    ].join('\n'));
    expect(out).not.toContain('❓');
  });

  it('sem seção de especificações → intacto', () => {
    const original = '🧵 INTRO\n\nTexto sem especificações.';
    expect(garantirPerguntas(original)).toBe(original);
  });

  it('não duplica pontuação quando o valor já termina em ponto', () => {
    const out = garantirPerguntas([
      '📌 ESPECIFICAÇÕES', '', '• Composição: 100% Poliéster.', '• Gramatura: 145g/m²', '• Largura: 1,50m',
    ].join('\n'));
    expect(out).toContain('▪ Qual a composição? 100% Poliéster.');
    expect(out).not.toContain('Poliéster..');
  });

  it('só bullets DESTA seção viram pergunta — não varre o resto do texto', () => {
    const out = garantirPerguntas([
      '📌 ESPECIFICAÇÕES', '', '• Composição: Algodão', '• Gramatura: 100g/m²',
      '', '📦 O QUE VOCÊ RECEBE', '', '• Largura: 1,50m', '• Peso: 2kg',
    ].join('\n'));
    expect(out).not.toContain('❓');
  });
});

describe('posProcessarDescricao — ordem dos guards (ADR-0115)', () => {
  it('a seção nasce DEPOIS de largura/metragem, aproveitando os bullets que eles injetam', () => {
    // Só dois rótulos mapeáveis vêm da IA; largura e metragem entram pelos guards e completam
    // o mínimo de três. Rodar garantirPerguntas antes deles perderia essas duas perguntas.
    const daIA = '🧵 INTRO\n\nTexto.\n\n📌 ESPECIFICAÇÕES\n\n• Composição: 100% Poliéster';
    const out = posProcessarDescricao(daIA, 'TECIDO 10MT', 'LARGURA: 150CM, 100% POLIESTER');
    expect(out).toContain('❓ PERGUNTAS SOBRE ESTE PRODUTO');
    expect(out).toContain('Qual a largura?');
    expect(out).toContain('Quantos metros possui?');
  });

  it('a poda roda antes: seção de 2 perguntas é removida e reconstruída completa', () => {
    const daIA = [
      '📌 ESPECIFICAÇÕES', '', '• Composição: 100% Poliéster', '• Gramatura: 145g/m²',
      '• Marca: Círculo', '', '❓ PERGUNTAS SOBRE ESTE PRODUTO', '', '▪ Uma? Sim.', '▪ Duas? Sim.',
    ].join('\n');
    const out = posProcessarDescricao(daIA, 'PRODUTO', 'SEM MEDIDAS');
    expect(out).not.toContain('▪ Uma? Sim.');
    expect(out).toContain('▪ Qual a composição? 100% Poliéster.');
    expect(out).toContain('▪ Qual a marca? Círculo.');
  });
});
