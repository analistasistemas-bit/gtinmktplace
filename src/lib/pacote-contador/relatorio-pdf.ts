// ADR-0181 Plano 2a — relatório de vendas (PDF, A4 paisagem). Tabela multipágina com cabeçalho repetido.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { totaisPorGrupo, rotuloTipo, rotuloStatus, type LeituraPacote } from './tipos';
import { dataHoraBR, linhasConferencia, reais, type Cabecalho } from './cabecalho';

const brl = (c: number) => reais(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function montarRelatorioPdf(l: LeituraPacote, cab: Cabecalho): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });   // compress: false (padrão)
  const c = l.conferencia;
  let y = 12;
  if (c.parcial) {
    doc.setTextColor(180, 0, 0); doc.setFontSize(11);
    doc.text(`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, 10, y); y += 6;
    doc.setTextColor(0, 0, 0);
  }
  doc.setFontSize(12);
  doc.text(`Relatório de vendas · ${cab.org} · ${c.mes}`, 10, y); y += 4;

  autoTable(doc, {
    startY: y + 2,
    head: [['Data de emissão', 'Tipo', 'Status', 'Número', 'Série', 'Chave', 'Produtos', 'Frete', 'Desconto', 'Total', 'CC-e']],
    body: l.notas.map((n) => [dataHoraBR(n.instante), rotuloTipo(n.tipo), rotuloStatus(n.status), n.numero, n.serie, n.chave,
      brl(n.produtosC), brl(n.freteC), brl(n.descontoC), brl(n.totalC), n.cartaCorrecao ? 'sim' : '']),
    styles: { fontSize: 7, cellPadding: 1 },
    headStyles: { fillColor: [60, 60, 60] },
    columnStyles: { 5: { fontSize: 6, cellWidth: 78 }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
    showHead: 'everyPage',
  });

  autoTable(doc, {
    head: [['Grupo', 'Quantidade', 'Produtos', 'Frete', 'Desconto', 'Total']],
    body: totaisPorGrupo(l.notas).map((t) => [t.grupo, String(t.quantidade), brl(t.produtosC), brl(t.freteC), brl(t.descontoC), brl(t.totalC)]),
    styles: { fontSize: 8 },
  });

  doc.addPage();
  doc.setFontSize(12);
  doc.text('Conferência', 10, 12);
  // 2 colunas explícitas: se a 1ª linha (selo PARCIAL) tivesse 1 célula, o autotable inferiria 1 coluna e cortaria os valores.
  autoTable(doc, {
    startY: 16,
    columns: [{ header: '', dataKey: 0 }, { header: '', dataKey: 1 }],
    showHead: 'never',
    body: linhasConferencia(l, cab),
    styles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 140 } },
  });
  return doc;
}

export function gerarRelatorioPdf(l: LeituraPacote, cab: Cabecalho): Uint8Array {
  return new Uint8Array(montarRelatorioPdf(l, cab).output('arraybuffer'));
}
