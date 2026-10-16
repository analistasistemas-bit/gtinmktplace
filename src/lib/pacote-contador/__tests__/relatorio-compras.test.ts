import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { gerarRelatorioComprasXlsx } from '../relatorio-compras-xlsx';
import { montarRelatorioComprasPdf } from '../relatorio-compras-pdf';
import { montarCompras } from '../compras-ler';
import { xmlCompra, row, ok, CH } from './fixtures-compras';

type L = Array<string | number>;
const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '', geradoEm: new Date('2026-11-02T12:00:00-03:00') };
const comp = montarCompras('2026-10', [row({ n: 1, divergencia_total_aceita: 0.5 }), row({ n: 2, status: 'desfeita', desfeita_em: '2026-10-15T12:00:00+00:00' })],
  new Map([['id-1', ok(xmlCompra({ n: 1, finNFe: '2', itens: [{ vProd: '10.00', vSeg: '1.25', vOutro: '0.75' }], tot: { vProd: '10.00', vSeg: '1.25', vOutro: '0.75', vNF: '12.00' } }))],
    ['id-2', ok(xmlCompra({ n: 2 }))]]));
const abrir = (b: Uint8Array) => XLSX.read(b, { type: 'array', cellNF: true });

describe('relatório de compras', () => {
  it('xlsx: abas, textos, formatos, totais e conferência', () => {
    const wb = abrir(gerarRelatorioComprasXlsx(comp, CAB));
    expect(wb.SheetNames).toEqual(['Compras', 'Conferência de compras']);
    const ws = wb.Sheets.Compras;
    const rows = XLSX.utils.sheet_to_json<L>(ws, { header: 1, raw: true });
    const i = rows.findIndex((r) => r[0] === 'Data de emissão');
    const cab = rows[i] as string[];
    const col = (nome: string) => cab.indexOf(nome);
    const r1 = i + 1;
    expect(rows[r1][col('Chave')]).toBe(CH(1));
    expect(rows[r1][col('Finalidade')]).toBe('2');
    for (const nome of ['Chave', 'NCM', 'CFOP', 'CNPJ', 'Número']) expect(ws[XLSX.utils.encode_cell({ r: r1, c: col(nome) })].t).toBe('s');
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Produtos') })]).toMatchObject({ v: 10, z: '#,##0.00' });
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Seguro') })].v).toBe(1.25);
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Quantidade') })].z).toBe('#,##0.####');
    expect(rows[r1][col('Tipo trib.')]).toBe('CSOSN');
    expect(rows.some((r) => r[0] === 'Total do mês' && r[1] === 12)).toBe(true);
    expect(rows.some((r) => r[0] === CH(1) && r[13] === 0.5)).toBe(true);   // divergência aceita
    const conf = XLSX.utils.sheet_to_json<L>(wb.Sheets['Conferência de compras'], { header: 1 }).flat().join(' | ');
    expect(conf).toContain('Compras pela data de emissão; só notas importadas no PubliAI.');
    expect(conf).toContain('desfeita no PubliAI em');
    expect(conf).toContain(CH(2));
    expect(conf).toContain('finNFe 2');
    // O SheetJS só lê `!cols` de volta com cellStyles.
    const cols = XLSX.read(gerarRelatorioComprasXlsx(comp, CAB), { type: 'array', cellNF: true, cellStyles: true }).Sheets.Compras['!cols'] ?? [];
    expect(cols[col('Chave')]?.wch).toBeGreaterThanOrEqual(44);   // 44 dígitos legíveis sem alargar à mão
    expect(cols[col('Fornecedor')]?.wch).toBeGreaterThanOrEqual(30);
  });
  it('PDF: colunas exigidas, totais e conferência; PARCIAL quando há falha', () => {
    const t = montarRelatorioComprasPdf(comp, CAB).output();
    for (const s of ['Total do m', 'Importa', 'CNPJ', 'Fin.', 'Seguro', 'Outras', 'vSeg', 'vOutro', 'Div. aceita', '11222333000181']) expect(t).toContain(s);
    const parcial = montarCompras('2026-10', [row({ n: 1 })], new Map([['id-1', { tipo: 'divergente' as const }]]));
    const p = montarRelatorioComprasPdf(parcial, CAB).output();
    expect(p).toContain('PACOTE PARCIAL');
    expect(p).toContain(CH(1));
  });
  it('mês vazio', () => {
    const wb = abrir(gerarRelatorioComprasXlsx(montarCompras('2026-10', [], new Map()), CAB));
    expect(XLSX.utils.sheet_to_json<L>(wb.Sheets['Conferência de compras'], { header: 1 }).flat().join(' ')).toContain('Nenhuma nota de compra no mês');
  });
});
