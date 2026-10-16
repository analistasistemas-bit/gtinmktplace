// ADR-0181 Plano 2b-1 — relatório de compras (PDF, A4 paisagem): itens, totais por nota e página de Conferência.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LeituraCompras } from './tipos-compras';
import { dataHoraBR, reais, type Cabecalho } from './cabecalho';
import { linhasConferenciaCompras } from './cabecalho-compras';

const brl = (c: number) => reais(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function montarRelatorioComprasPdf(l: LeituraCompras, cab: Cabecalho): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });   // compress: false (padrão)
  const c = l.conferencia;
  let y = 12;
  if (c.parcial) {
    doc.setTextColor(180, 0, 0); doc.setFontSize(11);
    doc.text(`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, 10, y, { maxWidth: 275 }); y += 6;
    doc.setTextColor(0, 0, 0);
  }
  doc.setFontSize(12);
  doc.text(`Relatório de compras · ${cab.org} · ${c.mes}`, 10, y); y += 4;
  autoTable(doc, {
    startY: y + 2,
    head: [['Emissão\nImportação', 'Fornecedor\nCNPJ', 'Nº/Série\nFin.', 'Chave', 'Item\nCód. fornecedor', 'Descrição', 'NCM\nCFOP', 'Trib.',
      'Qtd\nUn', 'Produtos', 'Frete\nSeguro', 'Desconto\nOutras', 'IPI', 'ST\nFCP-ST']],
    body: l.linhas.map((x) => [`${dataHoraBR(x.instante)}\n${dataHoraBR(Date.parse(x.importacao))}`, `${x.fornecedor}\n${x.cnpj}`,
      `${x.numero}/${x.serie}\n${x.finalidade}`, x.chave, `${x.nItem}\n${x.cProd}`, x.xProd, `${x.ncm}\n${x.cfop}`,
      x.tribTipo ? `${x.tribTipo} ${x.tribCodigo}` : 'não informado', `${x.qCom}\n${x.uCom}`, brl(x.produtosC),
      `${brl(x.freteC)}\n${brl(x.seguroC)}`, `${brl(x.descontoC)}\n${brl(x.outrasC)}`, brl(x.ipiC), `${brl(x.stC)}\n${brl(x.fcpstC)}`]),
    styles: { fontSize: 5.5, cellPadding: 0.8 },
    headStyles: { fillColor: [60, 60, 60] },
    columnStyles: { 3: { fontSize: 4.8, cellWidth: 50 } },
    showHead: 'everyPage',
  });
  autoTable(doc, {
    head: [['Chave', 'Nº', 'Fornecedor', 'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vST', 'vFCPST', 'vNF', 'Diferença', 'Div. aceita']],
    body: l.totaisNota.map((t) => [t.chave, t.numero, t.fornecedor, brl(t.vProdC), brl(t.vFreteC), brl(t.vSegC), brl(t.vDescC), brl(t.vOutroC),
      brl(t.vIPIC), brl(t.vSTC), brl(t.vFCPSTC), brl(t.vNFC), brl(t.diferencaC), t.divergenciaAceitaC == null ? '' : brl(t.divergenciaAceitaC)]),
    foot: [['Total do mês', '', '', '', '', '', '', '', '', '', '', brl(c.totalMesC), '', '']],
    styles: { fontSize: 6 },
    columnStyles: { 0: { fontSize: 4.8, cellWidth: 50 } },
  });
  doc.addPage();
  doc.setFontSize(12);
  doc.text('Conferência de compras', 10, 12);
  autoTable(doc, { startY: 16, columns: [{ header: '', dataKey: 0 }, { header: '', dataKey: 1 }], showHead: 'never',
    body: linhasConferenciaCompras(l, cab), styles: { fontSize: 8 }, columnStyles: { 0: { cellWidth: 120 } } });
  return doc;
}

export function gerarRelatorioComprasPdf(l: LeituraCompras, cab: Cabecalho): Uint8Array {
  return new Uint8Array(montarRelatorioComprasPdf(l, cab).output('arraybuffer'));
}
