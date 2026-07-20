import { jsPDF } from 'jspdf';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type {
  DashboardKpiVisual,
  DashboardMetrica,
  DashboardPdfVisual,
  DashboardProdutoVisual,
} from './tipos';
import { desenharPaginaGeografia } from './pdf-dashboard-mapa';

const TEXTO: [number, number, number] = [30, 41, 59];
const SUAVE: [number, number, number] = [100, 116, 139];
const AZUL: [number, number, number] = [37, 99, 235];
const FUNDO: [number, number, number] = [246, 248, 251];

export function escalaDashboard(
  valores: Array<number | null>,
  metrica: DashboardMetrica,
): { min: number; max: number; ticks: number[] } {
  const validos = valores.filter((valor): valor is number => Number.isFinite(valor));
  if (validos.length === 0) return { min: 0, max: 1, ticks: [0, 0.5, 1] };
  const menor = Math.min(0, ...validos);
  const maior = Math.max(0, ...validos);
  if (metrica === 'pedidos') {
    const max = Math.max(1, Math.ceil(maior));
    const min = Math.floor(menor);
    const passo = Math.max(1, Math.ceil((max - min) / 3));
    const ticks = Array.from({ length: 4 }, (_, i) => Math.min(max, min + passo * i));
    ticks[ticks.length - 1] = max;
    return { min, max, ticks: [...new Set(ticks)] };
  }
  if (menor === maior) {
    return { min: Math.min(0, menor), max: maior === 0 ? 1 : maior, ticks: [0, maior / 2, maior] };
  }
  return { min: menor, max: maior, ticks: [menor, menor + (maior - menor) / 2, maior] };
}

function truncar(doc: jsPDF, texto: string, largura: number): string {
  if (doc.getTextWidth(texto) <= largura) return texto;
  let corte = texto;
  while (corte.length > 1 && doc.getTextWidth(`${corte}…`) > largura) corte = corte.slice(0, -1);
  return `${corte.trimEnd()}…`;
}

function desenharCabecalho(doc: jsPDF, data: DashboardPdfVisual, emitidoEm: Date): void {
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...TEXTO);
  doc.text('Dashboard', 12, 18);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SUAVE);
  doc.text(`${data.periodo}  ·  ${data.canal}`, 12, 23);
  doc.text(`Emitido em ${emitidoEm.toLocaleString('pt-BR')}`, 285, 18, { align: 'right' });
  doc.setDrawColor(220, 226, 235).line(12, 26, 285, 26);
}

function desenharKpi(
  doc: jsPDF,
  kpi: DashboardKpiVisual,
  x: number,
  y: number,
  w: number,
  h: number,
  destaque: boolean,
): void {
  doc.setFillColor(...FUNDO).setDrawColor(225, 230, 238).roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...SUAVE);
  doc.text(truncar(doc, kpi.label, w - 8), x + 4, y + 6);
  doc.setFont('helvetica', 'bold').setFontSize(destaque ? 15 : 10).setTextColor(...TEXTO);
  doc.text(truncar(doc, kpi.valor, w - 8), x + 4, y + (destaque ? 15 : 12));
  if (destaque && kpi.delta) {
    const corDelta: [number, number, number] = kpi.tendencia === 'down' ? [190, 55, 55] : AZUL;
    doc.setFontSize(7.5).setTextColor(...corDelta);
    doc.text(truncar(doc, kpi.delta, w - 8), x + 4, y + 21);
  }
  if (kpi.auxiliar) {
    doc.setFont('helvetica', 'normal').setFontSize(6.7).setTextColor(...SUAVE);
    doc.text(truncar(doc, kpi.auxiliar, w - 8), x + 4, y + h - 3);
  }
}

function desenharAlertas(doc: jsPDF, alertas: string[], y: number): number {
  if (alertas.length === 0) return y;
  doc.setFillColor(255, 247, 224).roundedRect(12, y, 273, 9, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(145, 96, 20);
  doc.text(truncar(doc, `Atenção: ${alertas.join('  ·  ')}`, 265), 16, y + 5.8);
  return y + 9;
}

function desenharGrafico(
  doc: jsPDF,
  data: DashboardPdfVisual,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  doc.setDrawColor(225, 230, 238).roundedRect(x, y, w, h, 2, 2, 'S');
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXTO);
  doc.text('Evolução de vendas', x + 5, y + 8);
  const pontos = data.serie.filter((ponto) => Number.isFinite(ponto.valor));
  if (pontos.length === 0) {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SUAVE);
    doc.text('Sem vendas no período', x + w / 2, y + h / 2, { align: 'center' });
    return;
  }
  const escala = escalaDashboard(pontos.map((ponto) => ponto.valor), data.metrica);
  const px = x + 25;
  const py = y + 14;
  const pw = w - 31;
  const ph = h - 24;
  const faixa = escala.max - escala.min || 1;
  doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...SUAVE);
  for (const tick of escala.ticks) {
    const ty = py + ph - ((tick - escala.min) / faixa) * ph;
    doc.setDrawColor(232, 236, 242).line(px, ty, px + pw, ty);
    doc.text(data.metrica === 'pedidos' ? fmtInt(tick) : fmtBRL(tick), px - 2, ty + 1, { align: 'right' });
  }
  if (escala.min < 0) {
    const zeroY = py + ph - ((0 - escala.min) / faixa) * ph;
    doc.setDrawColor(130, 140, 155).line(px, zeroY, px + pw, zeroY);
  }
  const coords = pontos.map((ponto, i) => ({
    x: px + (pontos.length === 1 ? pw / 2 : (i / (pontos.length - 1)) * pw),
    y: py + ph - (((ponto.valor ?? 0) - escala.min) / faixa) * ph,
  }));
  doc.setDrawColor(...AZUL).setLineWidth(0.7);
  if (coords.length === 1) {
    doc.setFillColor(...AZUL).circle(coords[0].x, coords[0].y, 1.4, 'F');
  } else {
    doc.lines(
      coords.slice(1).map((ponto, i) => [ponto.x - coords[i].x, ponto.y - coords[i].y]),
      coords[0].x,
      coords[0].y,
    );
  }
  doc.setFontSize(6.5).setTextColor(...SUAVE);
  doc.text(pontos[0].rotulo, px, y + h - 5);
  if (pontos.length > 1) doc.text(pontos.at(-1)?.rotulo ?? '', px + pw, y + h - 5, { align: 'right' });
}

function desenharProdutos(
  doc: jsPDF,
  produtos: DashboardProdutoVisual[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  doc.setDrawColor(225, 230, 238).roundedRect(x, y, w, h, 2, 2, 'S');
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXTO);
  doc.text('Top produtos do período', x + 5, y + 8);
  doc.setFontSize(7.5);
  produtos.slice(0, 5).forEach((produto, i) => {
    const ry = y + 17 + i * 11;
    doc.setTextColor(...TEXTO).text(`${produto.posicao}. ${truncar(doc, produto.titulo, w - 45)}`, x + 5, ry);
    doc.setFont('helvetica', 'normal').setTextColor(...SUAVE);
    doc.text(`${fmtInt(produto.unidades)} un.`, x + 5, ry + 4);
    doc.setFont('helvetica', 'bold').setTextColor(...TEXTO);
    doc.text(fmtBRL(produto.faturamento), x + w - 5, ry + 4, { align: 'right' });
  });
  if (produtos.length === 0) {
    doc.setFont('helvetica', 'normal').setTextColor(...SUAVE);
    doc.text('Sem produtos no período', x + w / 2, y + h / 2, { align: 'center' });
  }
}

export function gerarPdfDashboard(data: DashboardPdfVisual, emitidoEm = new Date()): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  desenharCabecalho(doc, data, emitidoEm);
  const gap = 4;
  const heroW = (273 - gap) / 2;
  data.principais.forEach((kpi, i) => desenharKpi(doc, kpi, 12 + i * (heroW + gap), 31, heroW, 28, true));
  const cardW = (273 - gap * 2) / 3;
  data.secundarios.forEach((kpi, i) => {
    desenharKpi(doc, kpi, 12 + (i % 3) * (cardW + gap), 63 + Math.floor(i / 3) * 22, cardW, 18, false);
  });
  desenharAlertas(doc, data.alertas, 103);
  desenharGrafico(doc, data, 12, 116, 174, 78);
  desenharProdutos(doc, data.produtos, 190, 116, 95, 78);
  doc.addPage('a4', 'landscape');
  desenharPaginaGeografia(doc, data, emitidoEm);
  return doc;
}
