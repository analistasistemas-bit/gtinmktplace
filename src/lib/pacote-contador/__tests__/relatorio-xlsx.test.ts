import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { gerarRelatorioXlsx } from '../relatorio-xlsx';
import { lerPacote, lerPacoteVazio } from '../ler';
import { nfe, zip, CHAVE } from './fixtures';

type Linha = Array<string | number>;
const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '123', geradoEm: new Date('2026-10-16T12:00:00-03:00') };
const AG = new Date('2026-10-16T12:00:00-03:00');
const abrir = (b: Uint8Array) => XLSX.read(b, { type: 'array' });
const linhas = (wb: XLSX.WorkBook, aba: string) => XLSX.utils.sheet_to_json<Linha>(wb.Sheets[aba], { header: 1, raw: true });

describe('gerarRelatorioXlsx', () => {
  it('abas Vendas e Conferência; chave como texto; ordem por data; totais', () => {
    const l = lerPacote(zip({ 'a.xml': nfe({ n: 2, dhEmi: '2026-09-20T10:00:00-03:00', vNF: '10.00' }),
      'b.xml': nfe({ n: 1, dhEmi: '2026-09-05T10:00:00-03:00', vNF: '20.50' }) }), '2026-09', AG);
    const wb = abrir(gerarRelatorioXlsx(l, CAB));
    expect(wb.SheetNames).toEqual(['Vendas', 'Conferência']);
    const rows = linhas(wb, 'Vendas');
    const iCab = rows.findIndex((r) => r[0] === 'Data de emissão');
    expect(rows[iCab]).toEqual(['Data de emissão', 'Tipo', 'Status', 'Número', 'Série', 'Chave', 'Produtos', 'Frete', 'Desconto', 'Total', 'Carta de correção']);
    expect(rows[iCab + 1][3]).toBe('1');
    expect(rows[iCab + 1][5]).toBe(CHAVE(1));
    expect(wb.Sheets.Vendas[XLSX.utils.encode_cell({ r: iCab + 1, c: 5 })].t).toBe('s');
    expect(rows[iCab + 1][9]).toBe(20.5);
    expect(rows.some((r) => r[0] === 'Vendas autorizadas' && r[1] === 2 && r[5] === 30.5)).toBe(true);
    const conf = linhas(wb, 'Conferência').flat().join(' | ');
    expect(conf).toContain('Conciliação com as vendas não incluída nesta versão.');
    expect(conf).toContain('11444777000161');
  });
  it('colunas de dinheiro com 2 casas mesmo em valor inteiro; quantidade sem formato', () => {
    const l = lerPacote(zip({ 'a.xml': nfe({ n: 1, dhEmi: '2026-09-05T10:00:00-03:00', vNF: '10.00' }) }), '2026-09', AG);
    const wb = XLSX.read(gerarRelatorioXlsx(l, CAB), { type: 'array', cellNF: true });
    const rows = linhas(wb, 'Vendas');
    const iCab = rows.findIndex((r) => r[0] === 'Data de emissão');
    const cel = (r: number, c: number) => wb.Sheets.Vendas[XLSX.utils.encode_cell({ r, c })];
    expect(cel(iCab + 1, 9).z).toBe('#,##0.00');
    const iTot = rows.findIndex((r) => r[0] === 'Vendas autorizadas');
    expect(cel(iTot, 5).z).toBe('#,##0.00');
    expect(cel(iTot, 1).z).not.toBe('#,##0.00');
  });
  it('selo PACOTE PARCIAL no topo das duas abas', () => {
    const wb = abrir(gerarRelatorioXlsx(lerPacote(zip({ 'a.xml': '<x' }), '2026-09', AG), CAB));
    for (const aba of ['Vendas', 'Conferência']) expect(String(linhas(wb, aba)[0][0])).toMatch(/^PACOTE PARCIAL/);
  });
  it('mês vazio: "Nenhuma nota no mês" na Conferência', () => {
    const wb = abrir(gerarRelatorioXlsx(lerPacoteVazio('2026-09', AG), CAB));
    expect(linhas(wb, 'Conferência').flat().join(' ')).toContain('Nenhuma nota no mês');
  });
  it('avisos extras aparecem na Conferência, sem selo PARCIAL', () => {
    const l = lerPacoteVazio('2025-12', AG);
    l.conferencia.avisos = ['Foto de 31/12 inexistente — o inventário não vai neste pacote.'];
    const conf = linhas(abrir(gerarRelatorioXlsx(l, CAB)), 'Conferência').flat().join(' | ');
    expect(conf).toContain('Foto de 31/12 inexistente');
    expect(conf).not.toContain('PARCIAL');
  });
});
