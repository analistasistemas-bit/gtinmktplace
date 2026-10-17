// ADR-0181 Plano 2b-2 — relatório de inventário (PDF, A4 paisagem): Livro, totais, Conferência e avisos.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AVISOS_INVENTARIO, type LeituraInventario } from './tipos-inventario';
import { COLUNAS_CONFERENCIA_INV, COLUNAS_LIVRO, linhasCabecalhoInv, linhasConferenciaInv, linhasLivro, totaisInventario } from './cabecalho-inventario';

const num = (n: number, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function montarRelatorioInventarioPdf(l: LeituraInventario): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const livro = linhasLivro(l);
  const t = totaisInventario(livro);
  doc.setFontSize(12);
  doc.text('Relatório de inventário', 10, 12);
  autoTable(doc, { startY: 16, showHead: 'never', columns: [{ header: '', dataKey: 0 }, { header: '', dataKey: 1 }],
    // A fonte padrão do jsPDF descarta o travessão (U+2014): sai hífen, senão a frase do status perde o separador.
    body: linhasCabecalhoInv(l).map(([k, v]) => [k, v.replace(/—/g, '-')]), styles: { fontSize: 8 }, columnStyles: { 0: { cellWidth: 40 } } });
  autoTable(doc, {
    head: [COLUNAS_LIVRO],
    body: livro.map((x) => [x.item.codigo, x.item.descricao ?? '', x.item.ncm ?? '', x.item.unidade ?? '', x.item.cor ?? '', x.item.tamanho ?? '',
      x.qtd, x.avaliada, x.item.custo_medio == null ? '' : num(x.item.custo_medio, 6), num(x.valor), x.semNota, x.item.marcas.join(', ')]),
    foot: [['Totais', '', '', '', '', '', '', t.avaliadas, '', num(t.valor), t.semNota, '']],
    styles: { fontSize: 6, cellPadding: 0.8 }, headStyles: { fillColor: [60, 60, 60] }, showHead: 'everyPage',
  });
  doc.addPage();
  doc.setFontSize(12);
  doc.text('Conferência', 10, 12);
  autoTable(doc, { startY: 16, head: [COLUNAS_CONFERENCIA_INV], body: linhasConferenciaInv(l), styles: { fontSize: 7 }, headStyles: { fillColor: [60, 60, 60] } });
  autoTable(doc, { head: [['Avisos']], body: AVISOS_INVENTARIO.map((a) => [a]), styles: { fontSize: 7 }, headStyles: { fillColor: [60, 60, 60] } });
  return doc;
}

export function gerarRelatorioInventarioPdf(l: LeituraInventario): Uint8Array {
  return new Uint8Array(montarRelatorioInventarioPdf(l).output('arraybuffer'));
}
