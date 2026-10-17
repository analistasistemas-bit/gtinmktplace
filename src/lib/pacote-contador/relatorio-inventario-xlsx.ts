// ADR-0181 Plano 2b-2 — relatório de inventário (xlsx): Livro (quantidade > 0), totais e Conferência.
import * as XLSX from 'xlsx';
import { AVISOS_INVENTARIO, type LeituraInventario } from './tipos-inventario';
import { COLUNAS_CONFERENCIA_INV, COLUNAS_LIVRO, linhasCabecalhoInv, linhasConferenciaInv, linhasLivro, totaisInventario } from './cabecalho-inventario';

export { COLUNAS_CONFERENCIA_INV, COLUNAS_LIVRO };

export function gerarRelatorioInventarioXlsx(l: LeituraInventario): Uint8Array {
  const livro = linhasLivro(l);
  const t = totaisInventario(livro);
  const aoa: Array<Array<string | number>> = [['Relatório de inventário'], ...linhasCabecalhoInv(l), [], COLUNAS_LIVRO];
  const formatar: Array<{ r: number; c: number; z: string }> = [];
  for (const x of livro) {
    const r = aoa.length;
    const i = x.item;
    aoa.push([i.codigo, i.descricao ?? '', i.ncm ?? '', i.unidade ?? '', i.cor ?? '', i.tamanho ?? '', x.qtd, x.avaliada,
      i.custo_medio ?? '', x.valor, x.semNota, i.marcas.join(', ')]);
    formatar.push({ r, c: 8, z: '#,##0.000000' }, { r, c: 9, z: '#,##0.00' });
  }
  aoa.push([], ['Totais'], ['Valor total avaliado', t.valor], ['Unidades avaliadas', t.avaliadas], ['Unidades sem nota de compra', t.semNota]);
  formatar.push({ r: aoa.length - 3, c: 1, z: '#,##0.00' });
  const ws = XLSX.utils.aoa_to_sheet(aoa);   // strings → 't: s' (código e NCM ficam texto)
  for (const f of formatar) {
    const cel = ws[XLSX.utils.encode_cell({ r: f.r, c: f.c })] as XLSX.CellObject | undefined;
    if (cel?.t === 'n') cel.z = f.z;
  }
  ws['!cols'] = [16, 40, 10, 8, 12, 10, 10, 12, 16, 14, 14, 24].map((wch) => ({ wch }));
  const conf = XLSX.utils.aoa_to_sheet([COLUNAS_CONFERENCIA_INV, ...linhasConferenciaInv(l), [], ['Avisos'], ...AVISOS_INVENTARIO.map((a) => [a])]);
  conf['!cols'] = [16, 40, 10, 10, 10, 40, 24].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Livro');
  XLSX.utils.book_append_sheet(wb, conf, 'Conferência');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
