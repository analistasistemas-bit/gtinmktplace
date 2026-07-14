import { describe, it, expect } from 'vitest';
import { verificarOrigemInviolavel } from '../verificar-origem.ts';
import { mapearLinha } from '../mapear-linha.ts';
import { agruparPorPai, normalizarOrigem } from '../../_shared/parser.ts';

// Linha PAI crua da planilha (PAI='0') + um filho, com ORIGEM.
const planilha = (origem: string) => [
  { CODIGO: '2841240', PAI: '0', NOME: 'FITAS CORES (P)', UNIDADE: 'PC', GTIN: '1', ORIGEM: origem },
  { CODIGO: '2903261', PAI: '2841240', NOME: 'FITAS LARANJA', UNIDADE: 'PC', GTIN: '2', ORIGEM: origem },
];

describe('verificarOrigemInviolavel (trava ADR-0055)', () => {
  it('passa quando a origem montada bate com a ORIGEM crua (IMPORTADO)', () => {
    const rowsRaw = planilha('IMPORTADO');
    const { grupos } = agruparPorPai(rowsRaw.map(mapearLinha));
    expect(grupos[0].origem).toBe('importado');
    expect(() => verificarOrigemInviolavel(rowsRaw, grupos)).not.toThrow();
  });

  it('passa quando a planilha é nacional (sem ORIGEM ou NACIONAL)', () => {
    const rowsRaw = planilha('NACIONAL');
    const { grupos } = agruparPorPai(rowsRaw.map(mapearLinha));
    expect(() => verificarOrigemInviolavel(rowsRaw, grupos)).not.toThrow();
  });

  it('ABORTA se o pipeline dropar ORIGEM (planilha IMPORTADO mas grupo nacional)', () => {
    const rowsRaw = planilha('IMPORTADO');
    // simula o bug: map/pipeline que perde ORIGEM → grupo cai em nacional
    const grupos = [{ codigo_pai: '02841240', origem: 'nacional' as const }];
    expect(() => verificarOrigemInviolavel(rowsRaw, grupos)).toThrow(/Origem divergente.*ADR-0055/);
  });

  it('cadeia real: raw IMPORTADO → mapearLinha → agruparPorPai preserva importado (não lança)', () => {
    const rowsRaw = planilha('IMPORTADO');
    const rows = rowsRaw.map(mapearLinha);
    expect(rows[0].ORIGEM).toBe('IMPORTADO'); // o map carrega a coluna
    const { grupos } = agruparPorPai(rows);
    expect(normalizarOrigem(rows[0].ORIGEM)).toBe('importado');
    expect(() => verificarOrigemInviolavel(rowsRaw, grupos)).not.toThrow();
  });
});
