import { describe, it, expect } from 'vitest';
import { removerMarketingNaoGrounded } from '../titulo';

describe('removerMarketingNaoGrounded', () => {
  it('remove "NOVO" não-grounded sem tocar "NOVELO" (lote #28)', () => {
    const r = removerMarketingNaoGrounded(
      'NOVO NOVELO DE LINHA ANNE 500MT | 100% ALGODÃO MERCERIZADO',
      'ANNE 500MT CORES',
      'Novelo de linha 100% algodão mercerizado, ideal para crochê.',
    );
    expect(r).toBe('NOVELO DE LINHA ANNE 500MT | 100% ALGODÃO MERCERIZADO');
  });

  it('mantém "NOVO" quando a fonte genuinamente diz "produto novo"', () => {
    const r = removerMarketingNaoGrounded(
      'NOVO PRODUTO ANNE 500MT',
      'ANNE 500MT CORES',
      'Produto novo na linha, 100% algodão.',
    );
    expect(r).toBe('NOVO PRODUTO ANNE 500MT');
  });

  it('mantém "IMPORTADO" quando consta na descrição', () => {
    const r = removerMarketingNaoGrounded(
      'FITA CETIM IMPORTADO 10MT',
      'FITA CETIM 10MT',
      'Fita importada de alta qualidade, acabamento premium importado.',
    );
    expect(r).toBe('FITA CETIM IMPORTADO 10MT');
  });

  it('título sem termo de marketing fica inalterado', () => {
    const r = removerMarketingNaoGrounded(
      'FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | RESISTENTE',
      'FITA CETIM PROGRESSO N.1 100MT',
      '100% poliéster.',
    );
    expect(r).toBe('FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | RESISTENTE');
  });

  it('remoção que deixaria "|" órfão ou espaço duplo sai limpa', () => {
    const semPipe = removerMarketingNaoGrounded(
      'NOVO | FITA CETIM X',
      'FITA CETIM X',
      'Fita cetim sem termos de marketing.',
    );
    expect(semPipe).toBe('FITA CETIM X');

    const noMeio = removerMarketingNaoGrounded(
      'FITA NOVO CETIM X',
      'FITA CETIM X',
      'Fita cetim sem termos de marketing.',
    );
    expect(noMeio).toBe('FITA CETIM X');

    const noFim = removerMarketingNaoGrounded(
      'FITA CETIM X | NOVO',
      'FITA CETIM X',
      'Fita cetim sem termos de marketing.',
    );
    expect(noFim).toBe('FITA CETIM X');
  });

  it('é idempotente (aplicar 2x = aplicar 1x)', () => {
    const nome = 'ANNE 500MT CORES';
    const desc = 'Novelo de linha 100% algodão mercerizado, ideal para crochê.';
    const uma = removerMarketingNaoGrounded(
      'NOVO NOVELO DE LINHA ANNE 500MT | 100% ALGODÃO MERCERIZADO',
      nome,
      desc,
    );
    const duas = removerMarketingNaoGrounded(uma, nome, desc);
    expect(duas).toBe(uma);
  });
});
