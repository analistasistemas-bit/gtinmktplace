import { describe, it, expect } from 'vitest';
import {
  garantirLarguraDescricao,
  garantirMetragemDescricao,
  removerPerguntasIncompletas,
  posProcessarDescricao,
} from '../copywriter-prompt';

describe('garantirLarguraDescricao', () => {
  const nomePai = 'LANTEJOULAS TAM 6 CORES C/50MTS';
  const descricaoPai =
    'A LANTEJOULA TRANÇADA LISA DA BÚFALO DE 6MM DE LARGURA É O AVIAMENTO IDEAL PARA DECORAÇÕES.';

  it('bug real (produto 02994771): cria a seção ESPECIFICAÇÕES quando a IA pulou ela inteira', () => {
    const descricao = [
      '🧵 QUALIDADE PARA SUAS DECORAÇÕES',
      '',
      'As Lantejoulas são o aviamento ideal.',
      '',
      '🎯 INDICAÇÕES DE USO',
      '',
      '✔ Customização de roupas',
      '',
      '🎨 CORES DISPONÍVEIS',
      '',
      '- Dourado',
    ].join('\n');

    const out = garantirLarguraDescricao(descricao, nomePai, descricaoPai);

    expect(out).toContain('📌 ESPECIFICAÇÕES');
    expect(out).toContain('• Largura: 6mm');
    // a seção nova entra ANTES de INDICAÇÕES DE USO (ordem do template)
    expect(out.indexOf('📌 ESPECIFICAÇÕES')).toBeLessThan(out.indexOf('🎯 INDICAÇÕES DE USO'));
    // não perde nenhum conteúdo pré-existente
    expect(out).toContain('Customização de roupas');
    expect(out).toContain('Dourado');
  });

  it('injeta o bullet na seção ESPECIFICAÇÕES já existente, sem duplicar cabeçalho', () => {
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Marca: Búfalo',
      '',
      '🎯 INDICAÇÕES DE USO',
      '',
      '✔ Uso geral',
    ].join('\n');

    const out = garantirLarguraDescricao(descricao, nomePai, descricaoPai);

    expect((out.match(/📌 ESPECIFICAÇÕES/g) ?? []).length).toBe(1);
    expect(out).toContain('• Marca: Búfalo');
    expect(out).toContain('• Largura: 6mm');
    expect(out.indexOf('• Largura: 6mm')).toBeLessThan(out.indexOf('🎯 INDICAÇÕES DE USO'));
  });

  it('idempotente: não duplica quando a largura já está na descrição em qualquer lugar', () => {
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Largura: 6mm',
      '',
      '🎯 INDICAÇÕES DE USO',
    ].join('\n');

    expect(garantirLarguraDescricao(descricao, nomePai, descricaoPai)).toBe(descricao);
  });

  it('idempotente mesmo quando a IA escreveu com espaço ("6 mm" em vez de "6mm")', () => {
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Largura: 6 mm',
      '',
      '🎯 INDICAÇÕES DE USO',
    ].join('\n');

    expect(garantirLarguraDescricao(descricao, nomePai, descricaoPai)).toBe(descricao);
  });

  it('não mexe na descrição quando não há largura em mm grounded no nome/descrição', () => {
    const descricao = '🧵 INTRO\n\nTexto qualquer.\n\n🎯 INDICAÇÕES DE USO\n\n✔ Uso geral';
    expect(garantirLarguraDescricao(descricao, 'BARBANTE EUROROMA 600G', 'BARBANTE 100% ALGODÃO')).toBe(descricao);
  });

  it('quando não há nenhum cabeçalho conhecido após ESPECIFICAÇÕES, acrescenta no fim', () => {
    const descricao = 'Descrição sem seções formatadas.';
    const out = garantirLarguraDescricao(descricao, nomePai, descricaoPai);
    expect(out).toContain('📌 ESPECIFICAÇÕES');
    expect(out).toContain('• Largura: 6mm');
  });

  it('bug real (franjas 03106110/03070220/03106098): largura em CM na descrição, ausente do bullet', () => {
    const nomeFranja = 'FRANJA 5MM 100%FIBRA DE POLI 5MT';
    const descricaoFranja =
      'A FRANJA DA BÚFALO NA COR OURO, COM 5 CM DE LARGURA, É CONFECCIONADA EM MATERIAL 100% POLIÉSTER.';
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Composição: 100% poliéster',
      '• Metragem: 5 metros',
      '',
      '🎯 INDICAÇÕES DE USO',
    ].join('\n');

    const out = garantirLarguraDescricao(descricao, nomeFranja, descricaoFranja);

    expect(out).toContain('• Largura: 5cm');
    expect(out).toContain('• Metragem: 5 metros');
  });

  it('não confunde CM com MM: largura em cm não é considerada "já presente" por um valor em mm igual', () => {
    // nome_pai grounded em CM ("5 CM DE LARGURA"); descrição já tem "5mm" (unidade DIFERENTE,
    // dado diferente) — não pode contar como "já cravado" e pular a injeção do valor certo (cm).
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Diâmetro do fio: 5mm',
      '',
      '🎯 INDICAÇÕES DE USO',
    ].join('\n');

    const out = garantirLarguraDescricao(descricao, nomePai, 'PRODUTO COM 5 CM DE LARGURA.');
    expect(out).toContain('• Largura: 5cm');
  });
});

describe('garantirMetragemDescricao', () => {
  const nomePai = 'LANTEJOULAS TAM 6 CORES C/50MTS';

  it('bug real (produto 02994771, regenerado): cria a seção quando a IA pula metragem inteira, sem mencionar em prosa', () => {
    const descricao = [
      '🧵 INTRO',
      '',
      'Produzida em PVC de alta qualidade. Ideal para produções em larga escala.',
      '',
      '🎯 INDICAÇÕES DE USO',
      '',
      '✔ Uso geral',
    ].join('\n');

    const out = garantirMetragemDescricao(descricao, nomePai);

    expect(out).toContain('📌 ESPECIFICAÇÕES');
    expect(out).toContain('• Metragem: 50MT');
    expect(out.indexOf('📌 ESPECIFICAÇÕES')).toBeLessThan(out.indexOf('🎯 INDICAÇÕES DE USO'));
  });

  it('não duplica quando a IA já mencionou a metragem em prosa (sem bullet formal)', () => {
    const descricao = [
      '🧵 INTRO',
      '',
      'O produto vem em um rolo contendo 50 metros de rendimento.',
      '',
      '🎯 INDICAÇÕES DE USO',
    ].join('\n');

    expect(garantirMetragemDescricao(descricao, nomePai)).toBe(descricao);
  });

  it('idempotente quando já existe o bullet formal', () => {
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Metragem: 50MT',
      '',
      '🎯 INDICAÇÕES DE USO',
    ].join('\n');

    expect(garantirMetragemDescricao(descricao, nomePai)).toBe(descricao);
  });

  it('não mexe quando não há metragem grounded no nome', () => {
    const descricao = '🧵 INTRO\n\nTexto qualquer.\n\n🎯 INDICAÇÕES DE USO';
    expect(garantirMetragemDescricao(descricao, 'BARBANTE EUROROMA 600G')).toBe(descricao);
  });

  it('compõe com garantirLarguraDescricao sem duplicar o cabeçalho ESPECIFICAÇÕES', () => {
    const descricao = [
      '🧵 INTRO',
      '',
      'Texto qualquer.',
      '',
      '🎯 INDICAÇÕES DE USO',
    ].join('\n');
    const descricaoPai = 'PRODUTO DE 6MM DE LARGURA.';

    const out = garantirMetragemDescricao(
      garantirLarguraDescricao(descricao, nomePai, descricaoPai),
      nomePai,
    );

    expect((out.match(/📌 ESPECIFICAÇÕES/g) ?? []).length).toBe(1);
    expect(out).toContain('• Largura: 6mm');
    expect(out).toContain('• Metragem: 50MT');
  });
});

describe('guards × seção "Perguntas sobre este produto" (ADR-0098)', () => {
  it('injeta largura ANTES da seção de perguntas quando ESPECIFICAÇÕES foi pulada', () => {
    const descricao = [
      '🧵 INTRO',
      '',
      'Texto.',
      '',
      '❓ PERGUNTAS SOBRE ESTE PRODUTO',
      '',
      '▪ Qual a composição? 100% poliéster.',
    ].join('\n');

    // RE_LARGURA exige a palavra LARGURA perto do número — largura vem da descrição.
    const r = garantirLarguraDescricao(descricao, 'FITA CETIM N.3', 'LARGURA: 16MM.');

    expect(r).toContain('📌 ESPECIFICAÇÕES');
    expect(r).toContain('• Largura: 16mm');
    expect(r.indexOf('📌 ESPECIFICAÇÕES')).toBeLessThan(r.indexOf('❓ PERGUNTAS SOBRE ESTE PRODUTO'));
  });

  // Fixa comportamento PRÉ-EXISTENTE de propósito: contemMetragem aceita a menção em prosa
  // para não duplicar o dado. A seção nova cria mais um lugar onde isso dispara, então o
  // teste torna a decisão explícita em vez de acidental. Se falhar, não "conserte" o guard —
  // releia contemMetragem em titulo.ts e confirme o que ela aceita.
  it('metragem citada SÓ na resposta de uma pergunta suprime o bullet — tolerância a prosa é intencional', () => {
    const descricao = [
      '📌 ESPECIFICAÇÕES',
      '',
      '• Composição: 100% poliéster',
      '',
      '❓ PERGUNTAS SOBRE ESTE PRODUTO',
      '',
      '▪ Quantos metros possui? 10 metros.',
    ].join('\n');

    const r = garantirMetragemDescricao(descricao, 'FITA CETIM N.3 16MM 10MT');

    expect(r).not.toContain('• Metragem:');
    expect(r).toBe(descricao);
  });
});

// R6 manda omitir a seção com menos de 3 perguntas. Medido no experimento do ADR-0098:
// 10 das 22 seções geradas pelo gpt-4o-mini saíram com 1 ou 2 perguntas. O guard cobre
// a desobediência do modelo removendo o BLOCO INTEIRO — nunca remendando uma frase.
describe('removerPerguntasIncompletas — R6 (ADR-0098)', () => {
  const comPerguntas = (qtd: number) => [
    '📌 ESPECIFICAÇÕES',
    '',
    '• Composição: 100% poliéster',
    '',
    '❓ PERGUNTAS SOBRE ESTE PRODUTO',
    '',
    ...Array.from({ length: qtd }, (_, i) => `▪ Pergunta ${i + 1}? Resposta ${i + 1}.`),
    '',
    '🎨 CORES DISPONÍVEIS',
    '',
    '- Preto',
  ].join('\n');

  it('mantém a seção com 3 perguntas', () => {
    const r = removerPerguntasIncompletas(comPerguntas(3));
    expect(r).toContain('❓ PERGUNTAS SOBRE ESTE PRODUTO');
    expect(r).toContain('▪ Pergunta 3?');
  });

  it('remove a seção inteira com 2 perguntas, preservando o resto', () => {
    const r = removerPerguntasIncompletas(comPerguntas(2));
    expect(r).not.toContain('❓ PERGUNTAS SOBRE ESTE PRODUTO');
    expect(r).not.toContain('▪ Pergunta 1?');
    expect(r).toContain('📌 ESPECIFICAÇÕES');
    expect(r).toContain('• Composição: 100% poliéster');
    expect(r).toContain('🎨 CORES DISPONÍVEIS');
    expect(r).toContain('- Preto');
  });

  it('remove a seção com 1 pergunta', () => {
    expect(removerPerguntasIncompletas(comPerguntas(1))).not.toContain('PERGUNTAS SOBRE ESTE PRODUTO');
  });

  it('descrição sem a seção passa intacta', () => {
    const d = '📌 ESPECIFICAÇÕES\n\n• Composição: 100% poliéster';
    expect(removerPerguntasIncompletas(d)).toBe(d);
  });

  it('seção incompleta no fim da descrição (sem cabeçalho posterior) é removida', () => {
    const d = '📌 ESPECIFICAÇÕES\n\n• Composição: X\n\n❓ PERGUNTAS SOBRE ESTE PRODUTO\n\n▪ Só uma? Sim.';
    const r = removerPerguntasIncompletas(d);
    expect(r).not.toContain('PERGUNTAS SOBRE ESTE PRODUTO');
    expect(r).toContain('📌 ESPECIFICAÇÕES');
  });
});

describe('posProcessarDescricao — composição única dos guards (ADR-0098)', () => {
  it('aplica largura, metragem e a poda de perguntas numa passada só', () => {
    const descricao = [
      '🧵 INTRO',
      '',
      'Texto.',
      '',
      '❓ PERGUNTAS SOBRE ESTE PRODUTO',
      '',
      '▪ Uma só? Sim.',
      '',
      '🎨 CORES DISPONÍVEIS',
    ].join('\n');

    const r = posProcessarDescricao(descricao, 'FITA CETIM N.3 50MT', 'LARGURA: 16MM.');

    expect(r).toContain('• Largura: 16mm');
    expect(r).toContain('• Metragem: 50MT');
    expect(r).not.toContain('PERGUNTAS SOBRE ESTE PRODUTO');
    expect(r).toContain('🎨 CORES DISPONÍVEIS');
  });
});
