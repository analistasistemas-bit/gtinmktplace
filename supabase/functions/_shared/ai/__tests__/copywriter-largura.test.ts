import { describe, it, expect } from 'vitest';
import { garantirLarguraDescricao, garantirMetragemDescricao } from '../copywriter-prompt';

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
