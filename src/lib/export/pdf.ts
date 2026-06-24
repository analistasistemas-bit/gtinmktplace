import { jsPDF } from 'jspdf';
import autoTable, { type RowInput, type CellInput } from 'jspdf-autotable';
import type { ReportData, Celula, Coluna } from './tipos';

const COR_TEXTO: [number, number, number] = [30, 30, 30];
const COR_SUAVE: [number, number, number] = [120, 120, 120];
const COR_PRIMARIA: [number, number, number] = [37, 99, 235]; // azul
const COR_CARD: [number, number, number] = [243, 244, 246];
const COR_SUBLINHA: [number, number, number] = [246, 247, 249];

const MARGEM = 14;

function fmtCelula(v: string | number | null): string {
  if (v == null) return '';
  return String(v);
}

function dataEmissao(): string {
  const d = new Date();
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Desenha o cabeçalho (título, período, filtros, emissão) e devolve o Y final. */
function desenharCabecalho(doc: jsPDF, data: ReportData): number {
  const larguraPagina = doc.internal.pageSize.getWidth();
  let y = MARGEM;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COR_TEXTO);
  doc.text(data.titulo, MARGEM, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COR_SUAVE);
  doc.text(`Emitido em ${dataEmissao()}`, larguraPagina - MARGEM, y, { align: 'right' });

  y += 6;
  doc.setFontSize(9);
  if (data.periodo) {
    doc.text(`Período: ${data.periodo}`, MARGEM, y);
    y += 5;
  }
  if (data.filtros?.length) {
    const linhas = doc.splitTextToSize(`Filtros: ${data.filtros.join('  ·  ')}`, larguraPagina - MARGEM * 2);
    doc.text(linhas, MARGEM, y);
    y += linhas.length * 4.5;
  }
  return y + 2;
}

/** Desenha os KPIs como cards e devolve o Y final. */
function desenharKpis(doc: jsPDF, data: ReportData, yInicial: number): number {
  if (!data.kpis?.length) return yInicial;
  const larguraPagina = doc.internal.pageSize.getWidth();
  const disponivel = larguraPagina - MARGEM * 2;
  const porLinha = Math.min(4, data.kpis.length);
  const gap = 4;
  const largura = (disponivel - gap * (porLinha - 1)) / porLinha;
  const altura = 16;
  let y = yInicial;

  data.kpis.forEach((kpi, i) => {
    const col = i % porLinha;
    if (col === 0 && i > 0) y += altura + gap;
    const x = MARGEM + col * (largura + gap);
    doc.setFillColor(...COR_CARD);
    doc.roundedRect(x, y, largura, altura, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COR_SUAVE);
    doc.text(kpi.label.toUpperCase(), x + 3, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COR_TEXTO);
    doc.text(doc.splitTextToSize(kpi.valor, largura - 6)[0] ?? kpi.valor, x + 3, y + 12);
  });
  return y + altura + 4;
}

function alinhar(colunas: Coluna[]): Record<number, { halign: 'left' | 'right' | 'center' }> {
  const m: Record<number, { halign: 'left' | 'right' | 'center' }> = {};
  colunas.forEach((c, i) => {
    if (c.alinhamento) m[i] = { halign: c.alinhamento };
  });
  return m;
}

function linhaSublinha(colunas: Coluna[], celulas: Celula, total: number): CellInput {
  const texto = colunas.map((c) => `${c.titulo}: ${fmtCelula(celulas[c.chave])}`).join('   ·   ');
  return {
    content: `↳  ${texto}`,
    colSpan: total,
    styles: { fontSize: 7, textColor: COR_SUAVE, fillColor: COR_SUBLINHA, cellPadding: { top: 1, bottom: 1, left: 6, right: 2 } },
  };
}

/** Gera o documento PDF a partir de ReportData. Sublinhas só aparecem se presentes em data. */
export function gerarPdf(data: ReportData): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  let y = desenharCabecalho(doc, data);
  y = desenharKpis(doc, data, y);

  const total = data.colunas.length;
  const body: RowInput[] = [];
  for (const linha of data.linhas) {
    body.push(data.colunas.map((c) => fmtCelula(linha.celulas[c.chave])));
    if (linha.sublinhas) {
      for (const sl of linha.sublinhas.linhas) {
        body.push([linhaSublinha(linha.sublinhas.colunas, sl, total)]);
      }
    }
  }

  autoTable(doc, {
    startY: y,
    head: [data.colunas.map((c) => c.titulo)],
    body,
    margin: { left: MARGEM, right: MARGEM },
    styles: { fontSize: 8, cellPadding: 1.5, textColor: COR_TEXTO, overflow: 'linebreak' },
    headStyles: { fillColor: COR_PRIMARIA, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 251] },
    columnStyles: alinhar(data.colunas),
  });

  return doc;
}
