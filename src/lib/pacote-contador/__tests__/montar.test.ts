import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { montarPacote, nomePacote, mesesDisponiveis, mesAnteriorSP } from '../montar';
import { lerPacote, lerPacoteVazio } from '../ler';
import { nfe, zip } from './fixtures';

const AG = new Date('2026-10-16T12:00:00-03:00');
describe('montarPacote', () => {
  it('XMLs originais em xmls/ + 2 relatórios', () => {
    const l = lerPacote(zip({ 'Emitidas/a.xml': nfe({ n: 1 }) }), '2026-09', AG);
    const z = unzipSync(montarPacote(l, new Uint8Array([1]), new Uint8Array([2])));
    expect(Object.keys(z).sort()).toEqual(['relatorio-vendas.pdf', 'relatorio-vendas.xlsx', 'xmls/Emitidas/a.xml']);
    expect(strFromU8(z['xmls/Emitidas/a.xml'])).toContain('nfeProc');
  });
  it('vazio: só relatórios', () => {
    const z = unzipSync(montarPacote(lerPacoteVazio('2026-09', AG), new Uint8Array([1]), new Uint8Array([2])));
    expect(Object.keys(z).sort()).toEqual(['relatorio-vendas.pdf', 'relatorio-vendas.xlsx']);
  });
  it('nome e meses (sem futuro, fuso de São Paulo)', () => {
    expect(nomePacote('2026-09')).toBe('pacote-2026-09.zip');
    const virada = new Date('2026-11-01T02:00:00Z'); // ainda 31/10 em São Paulo
    expect(mesesDisponiveis(virada, 3)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(mesAnteriorSP(virada)).toBe('2026-09');
    expect(mesesDisponiveis(new Date('2026-01-10T12:00:00-03:00'), 2)).toEqual(['2026-01', '2025-12']);
  });
});
