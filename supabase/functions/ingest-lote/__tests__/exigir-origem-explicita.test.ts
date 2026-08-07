import { describe, it, expect } from 'vitest';
import { exigirOrigemExplicita, verificarOrigemInviolavel } from '../verificar-origem.ts';
import { mapearLinha } from '../mapear-linha.ts';
import { agruparPorPai } from '../../_shared/parser.ts';

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

  // `validarColunas` normaliza o cabeçalho (toUpperCase().trim()), então uma planilha com header
  // `Origem` passa na validação. Ler `row.ORIGEM` na unha faria o valor chegar undefined em todo
  // o pipeline — 8% em silêncio de novo, com a trava do ADR-0055 aprovando (crua e montada
  // concordariam em 'nacional'). O caminho inteiro tem que enxergar a coluna.
  it('enxerga o cabeçalho em qualquer caixa (Origem, origem) ponta a ponta', () => {
    const rowsRaw = [
      { CODIGO: '2841240', PAI: '0', NOME: 'FITAS (P)', Origem: 'IMPORTADO' },
      { CODIGO: '2903261', PAI: '2841240', NOME: 'FITA LARANJA', Origem: 'IMPORTADO' },
    ];
    expect(() => exigirOrigemExplicita(rowsRaw)).not.toThrow();
    const { grupos } = agruparPorPai(rowsRaw.map(mapearLinha));
    expect(grupos[0].origem).toBe('importado');
    expect(() => verificarOrigemInviolavel(rowsRaw, grupos)).not.toThrow();
  });

  it('header em outra caixa com valor inválido também aborta', () => {
    expect(() => exigirOrigemExplicita([{ CODIGO: '2841240', PAI: '0', origem: 'IMPORTADA' }])).toThrow(/IMPORTADA/);
  });
});
