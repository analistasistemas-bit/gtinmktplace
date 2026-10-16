import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { montarPacote, comSeloGlobal, nomePacote, mesesDisponiveis, mesAnteriorSP } from '../montar';
import { lerPacote, lerPacoteVazio, lerPacoteIndisponivel } from '../ler';
import { montarCompras } from '../compras-ler';
import { nfe, zip } from './fixtures';
import { xmlCompra, row, ok, CH } from './fixtures-compras';

const AG = new Date('2026-10-16T12:00:00-03:00');
const COMP = montarCompras('2026-10', [row({ n: 1 }), row({ n: 2, status: 'desfeita' }), row({ n: 3, status: 'cancelada' })],
  new Map([['id-1', ok(xmlCompra({ n: 1 }))], ['id-2', ok(xmlCompra({ n: 2 }))], ['id-3', ok(xmlCompra({ n: 3 }))]]));
const B = new Uint8Array([1]);
describe('montarPacote', () => {
  it('vendas (xmls/) + compras (3 pastas) + 4 relatórios', () => {
    const l = lerPacote(zip({ 'Emitidas/a.xml': nfe({ n: 1 }) }), '2026-09', AG);
    const z = unzipSync(montarPacote({ vendas: l, xlsxVendas: B, pdfVendas: B, compras: COMP, xlsxCompras: B, pdfCompras: B }));
    expect(Object.keys(z).sort()).toEqual([`compras/xmls-canceladas/${CH(3)}.xml`, `compras/xmls-desfeitas/${CH(2)}.xml`, `compras/xmls/${CH(1)}.xml`,
      'relatorio-compras.pdf', 'relatorio-compras.xlsx', 'relatorio-vendas.pdf', 'relatorio-vendas.xlsx', 'xmls/Emitidas/a.xml']);
    expect(strFromU8(z['xmls/Emitidas/a.xml'])).toBe(nfe({ n: 1 }));
  });
  it('vendas vazias ou indisponíveis: sem xmls/ de vendas', () => {
    for (const vendas of [lerPacoteVazio('2026-09', AG), lerPacoteIndisponivel('2026-09', 'x', AG)]) {
      const z = unzipSync(montarPacote({ vendas, xlsxVendas: B, pdfVendas: B, compras: COMP, xlsxCompras: B, pdfCompras: B }));
      expect(Object.keys(z).some((k) => k.startsWith('xmls/'))).toBe(false);
    }
  });
  it('comSeloGlobal junta os motivos sem mutar a leitura original', () => {
    const v = lerPacoteVazio('2026-09', AG);
    const g = comSeloGlobal(v, ['vendas indisponíveis', '1 compras com falha']);
    expect(g.conferencia).toMatchObject({ parcial: true, motivosParcial: ['vendas indisponíveis', '1 compras com falha'] });
    expect(v.conferencia.parcial).toBe(false);
  });
  it('nome e meses (sem futuro, fuso de São Paulo)', () => {
    expect(nomePacote('2026-09')).toBe('pacote-2026-09.zip');
    const virada = new Date('2026-11-01T02:00:00Z'); // ainda 31/10 em São Paulo
    expect(mesesDisponiveis(virada, 3)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(mesAnteriorSP(virada)).toBe('2026-09');
    expect(mesesDisponiveis(new Date('2026-01-10T12:00:00-03:00'), 2)).toEqual(['2026-01', '2025-12']);
  });
});
