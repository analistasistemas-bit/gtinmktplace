import { describe, it, expect } from 'vitest';
import { exigirOrigemExplicita } from '../verificar-origem.ts';

const pai = (codigo: string, origem: unknown) => ({ CODIGO: codigo, PAI: '0', NOME: 'FITAS (P)', ORIGEM: origem });
const filho = (codigo: string, codigoPai: string, origem: unknown) => ({ CODIGO: codigo, PAI: codigoPai, NOME: 'FITA LARANJA', ORIGEM: origem });

describe('exigirOrigemExplicita (ADR-0107)', () => {
  it('passa quando todo PAI traz NACIONAL ou IMPORTADO', () => {
    expect(() => exigirOrigemExplicita([
      pai('2841240', 'IMPORTADO'), filho('2903261', '2841240', 'IMPORTADO'),
      pai('2841241', 'NACIONAL'), filho('2903262', '2841241', 'NACIONAL'),
    ])).not.toThrow();
  });

  it('aceita minúscula e espaços', () => {
    expect(() => exigirOrigemExplicita([pai('2841240', ' importado ')])).not.toThrow();
  });

  it('ABORTA quando a célula do PAI está vazia (não defaulta em nacional)', () => {
    expect(() => exigirOrigemExplicita([pai('2841240', null)])).toThrow(/02841240/);
    expect(() => exigirOrigemExplicita([pai('2841240', '  ')])).toThrow(/02841240/);
  });

  it('ABORTA em valor inválido e mostra o que veio na planilha', () => {
    expect(() => exigirOrigemExplicita([pai('2841240', 'IMPORTADA')])).toThrow(/IMPORTADA/);
  });

  it('lista TODOS os pais problemáticos, não só o primeiro', () => {
    const erro = (() => {
      try { exigirOrigemExplicita([pai('2841240', null), pai('2841241', 'EXTERIOR'), pai('2841242', 'NACIONAL')]); }
      catch (e) { return (e as Error).message; }
    })();
    expect(erro).toMatch(/02841240/);
    expect(erro).toMatch(/02841241/);
    expect(erro).not.toMatch(/02841242/);
  });

  it('ignora a coluna nas linhas filhas — só a linha PAI decide (ADR-0055)', () => {
    expect(() => exigirOrigemExplicita([
      pai('2841240', 'IMPORTADO'), filho('2903261', '2841240', null),
    ])).not.toThrow();
  });

  it('trata PAI vazio como agrupador, igual à trava de origem', () => {
    expect(() => exigirOrigemExplicita([{ CODIGO: '2841240', PAI: '', NOME: 'X', ORIGEM: null }])).toThrow(/02841240/);
  });
});
