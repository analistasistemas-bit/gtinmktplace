import { describe, it, expect } from 'vitest';
import { extrairLarguraMm, garantirLarguraDescricao } from '../copywriter-prompt';

describe('extrairLarguraMm', () => {
  it('captura "6MM DE LARGURA"', () => {
    expect(extrairLarguraMm('A LANTEJOULA DE 6MM DE LARGURA É IDEAL')).toBe('6mm');
  });

  it('captura ordem invertida "LARGURA DE 6MM"', () => {
    expect(extrairLarguraMm('FITA COM LARGURA DE 10MM')).toBe('10mm');
  });

  it('captura "LARGURA: 6MM" (rótulo com dois-pontos)', () => {
    expect(extrairLarguraMm('LARGURA: 6MM')).toBe('6mm');
  });

  it('aceita decimal com vírgula (formato BR)', () => {
    expect(extrairLarguraMm('FITA DE 2,5MM DE LARGURA')).toBe('2,5mm');
  });

  it('não confunde metragem em metros ("M"/"MT"/"METROS") com largura em mm', () => {
    expect(extrairLarguraMm('ROLO CONTENDO 50 METROS')).toBeNull();
    expect(extrairLarguraMm('FITA 10MT BRANCA')).toBeNull();
  });

  it('sem menção a largura em mm → null', () => {
    expect(extrairLarguraMm('BARBANTE DE ALGODÃO 4/6 FIOS')).toBeNull();
  });
});

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
