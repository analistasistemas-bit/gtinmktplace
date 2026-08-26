import { describe, expect, it } from 'vitest';
import { exigirFiscalExplicito } from '../verificar-fiscal.ts';

const pai = (extra: Record<string, unknown>) => ({ CODIGO: '00100', PAI: '0', ...extra });

describe('exigirFiscalExplicito (org com módulo fiscal — ADR-0135)', () => {
  it('PAI com NCM de 8 dígitos passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090' })])).not.toThrow();
  });
  it('PAI sem NCM aborta nomeando o código', () => {
    expect(() => exigirFiscalExplicito([pai({})])).toThrow(/00100.*NCM.*vazio/s);
  });
  it('NCM com máscara 3926.90.90 é normalizado e passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '3926.90.90' })])).not.toThrow();
  });
  it('acumula TODOS os PAIs problemáticos numa mensagem só', () => {
    expect(() => exigirFiscalExplicito([
      pai({}), { CODIGO: '00200', PAI: '0', NCM: 'abc' },
    ])).toThrow(/2 produto\(s\) PAI/);
  });
  it('linha filha (PAI != 0) é ignorada', () => {
    expect(() => exigirFiscalExplicito([{ CODIGO: '00101', PAI: '00100' }])).not.toThrow();
  });
  it('ORIGEM_NFE presente mas inválida aborta (opcional ≠ silencioso)', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090', ORIGEM_NFE: '9' })]))
      .toThrow(/ORIGEM_NFE/);
  });
  it('CSOSN de um dos códigos do cadastro manual passa', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090', CSOSN: '102' })])).not.toThrow();
  });
  it('CSOSN fora da lista aborta (opcional ≠ silencioso)', () => {
    expect(() => exigirFiscalExplicito([pai({ NCM: '39269090', CSOSN: '999' })]))
      .toThrow(/CSOSN/);
  });
});
