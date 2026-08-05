import { describe, it, expect } from 'vitest';

import { SYSTEM } from '../copywriter-prompt';

/**
 * ADR-0102 — o template não promete logística nem crava o conteúdo da embalagem.
 *
 * Medido em produção: 298 de 304 descrições continham "envio rápido e seguro para todo o Brasil",
 * 292 delas publicadas — e NENHUMA com respaldo na fonte. A frase vinha hardcoded no template.
 * O próprio sistema já bane essas palavras no título (T3).
 */

describe('template da descrição: sem promessa logística (ADR-0102)', () => {
  /**
   * Substring pura não serve aqui: o SYSTEM cita "envio rápido"/"pronta entrega" para PROIBI-las,
   * exatamente como o T3 faz no título. O que precisa sumir é a seção do template que mandava
   * escrever a promessa — e a frase-modelo que 298 famílias copiaram literalmente.
   */
  it('não traz mais a seção de envio no template', () => {
    const secoesDoTemplate = SYSTEM.slice(SYSTEM.indexOf('DESCRIÇÃO — TEMPLATE OBRIGATÓRIO'));
    expect(secoesDoTemplate).not.toMatch(/^🚚 ENVIO RÁPIDO$/m);
  });

  it('não traz a frase-modelo que foi copiada para 298 descrições', () => {
    expect(SYSTEM).not.toContain('Produto à pronta entrega com envio rápido e seguro para todo o Brasil');
  });

  it('proíbe explicitamente escrever sobre envio, frete e prazo', () => {
    expect(SYSTEM).toMatch(/NUNCA escreva seção sobre envio/i);
  });

  it('não crava o conteúdo da embalagem como frase literal', () => {
    expect(SYSTEM).not.toContain('1 unidade do produto na cor de sua escolha');
  });

  it('manda derivar o conteúdo da embalagem do dado da fonte', () => {
    expect(SYSTEM).toMatch(/CONTEÚDO DA EMBALAGEM/);
    expect(SYSTEM.toLowerCase()).toMatch(/derive|derivad|a partir d/);
  });
});

describe('template da descrição: abertura nomeia o produto (ADR-0102)', () => {
  it('limita o contexto de categoria a uma frase', () => {
    expect(SYSTEM).toMatch(/no m[áa]ximo UMA frase|UMA frase de contexto/i);
  });

  it('exige o produto nomeado no primeiro parágrafo', () => {
    expect(SYSTEM).toMatch(/nomeie o produto|produto .{0,40}primeiro par[áa]grafo/i);
  });
});

/**
 * Trava de compatibilidade com o legado. Remover a seção do TEMPLATE não remove a string das
 * 295 descrições já gravadas — os guards de injeção continuam precisando reconhecer
 * '🚚 ENVIO RÁPIDO' como fronteira de seção, senão passam a inserir especificações no lugar
 * errado justamente nas descrições antigas.
 */
describe('compatibilidade com descrições legadas', () => {
  it('o cabeçalho de envio segue reconhecido como fronteira pelos guards', async () => {
    const mod = await import('../copywriter-prompt');
    const fonte = String((mod as Record<string, unknown>).SYSTEM);
    expect(fonte).toBeTruthy();

    // A garantia real é comportamental: uma descrição legada com a seção ENVIO deve receber o
    // bullet de especificações ANTES dela, nunca depois.
    const legada = [
      '🧵 FITA',
      '',
      'Texto.',
      '',
      '📌 ESPECIFICAÇÕES',
      '',
      '• Marca: Búfalo',
      '',
      '🚚 ENVIO RÁPIDO',
      '',
      'Produto à pronta entrega com envio rápido e seguro para todo o Brasil.',
    ].join('\n');

    const { posProcessarDescricao } = mod as {
      posProcessarDescricao: (d: string, n: string, ds: string) => string;
    };
    const out = posProcessarDescricao(legada, 'FITA CETIM 25MM 50MT', 'FITA DE CETIM 25MM. 50 METROS.');

    const idxMetragem = out.indexOf('Metragem');
    const idxEnvio = out.indexOf('🚚 ENVIO RÁPIDO');
    expect(idxMetragem).toBeGreaterThan(-1);
    expect(idxEnvio).toBeGreaterThan(-1);
    expect(idxMetragem).toBeLessThan(idxEnvio);
  });
});
