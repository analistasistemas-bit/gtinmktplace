import { jsPDF } from 'jspdf';
import { BRASIL_UF_GEOJSON } from '@/lib/geo/brasil-uf';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type { DashboardPdfVisual } from './tipos';

export interface AreaMapa {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface PontoMapa {
  x: number;
  y: number;
}

type PoligonosProjetados = PontoMapa[][][];
const TEXTO: [number, number, number] = [30, 41, 59];
const SUAVE: [number, number, number] = [100, 116, 139];
const VIOLETA: [number, number, number] = [124, 58, 237];

export function corPorIntensidade(
  pedidos: number,
  maxPedidos: number,
): [number, number, number] {
  const intensidade = Math.max(0, Math.min(1, pedidos / Math.max(1, maxPedidos)));
  const mistura = 0.18 + intensidade * 0.82;
  return [
    Math.round(255 + (VIOLETA[0] - 255) * mistura),
    Math.round(255 + (VIOLETA[1] - 255) * mistura),
    Math.round(255 + (VIOLETA[2] - 255) * mistura),
  ];
}

export function projetarMapaBrasil(area: AreaMapa): Map<string, PoligonosProjetados> {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of BRASIL_UF_GEOJSON.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      }
    }
  }

  const midLat = (minLat + maxLat) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const naturalW = (maxLng - minLng) * k;
  const naturalH = maxLat - minLat;
  const scale = Math.min(area.largura / naturalW, area.altura / naturalH);
  const offsetX = area.x + (area.largura - naturalW * scale) / 2;
  const offsetY = area.y + (area.altura - naturalH * scale) / 2;
  const project = (lng: number, lat: number): PontoMapa => ({
    x: offsetX + (lng - minLng) * k * scale,
    y: offsetY + (maxLat - lat) * scale,
  });

  return new Map(BRASIL_UF_GEOJSON.features.map((feature) => [
    feature.properties.sigla,
    feature.geometry.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(([lng, lat]) => project(lng, lat)))),
  ]));
}

function cabecalho(doc: jsPDF, data: DashboardPdfVisual, emitidoEm: Date): void {
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...TEXTO);
  doc.text('Dashboard · Geografia', 12, 17);
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...SUAVE);
  doc.text(`${data.periodo}  ·  ${data.canal}`, 12, 22);
  doc.text(`Emitido em ${emitidoEm.toLocaleString('pt-BR')}`, 285, 17, { align: 'right' });
  doc.setDrawColor(220, 226, 235).line(12, 25, 285, 25);
}

function liberacoes(doc: jsPDF, data: DashboardPdfVisual): void {
  doc.setDrawColor(225, 230, 238).roundedRect(12, 29, 273, 23, 2, 2, 'S');
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXTO);
  doc.text('Liberações próximas', 17, 36);
  if (data.liberacoes.length === 0) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SUAVE);
    doc.text('Nada a liberar no horizonte', 148.5, 44, { align: 'center' });
    return;
  }
  const itens = data.liberacoes.slice(0, 6);
  const largura = 263 / itens.length;
  itens.forEach((item, i) => {
    const x = 17 + i * largura;
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...SUAVE);
    const data = /^\d{2}\/\d{2}$/.test(item.data)
      ? item.data
      : new Date(`${item.data}T12:00:00`).toLocaleDateString('pt-BR');
    doc.text(data, x, 42);
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...TEXTO);
    doc.text(fmtBRL(item.valor), x, 47);
  });
}

function mapa(doc: jsPDF, data: DashboardPdfVisual): void {
  const valores = new Map(data.geografia.map((item) => [item.uf, item.pedidos]));
  const maxPedidos = Math.max(1, ...data.geografia.map((item) => item.pedidos));
  const projetado = projetarMapaBrasil({ x: 20, y: 65, largura: 122, altura: 110 });
  doc.setLineWidth(0.18).setDrawColor(203, 210, 220);
  for (const [uf, polygons] of projetado) {
    const pedidos = valores.get(uf) ?? 0;
    if (pedidos === 0) doc.setFillColor(238, 241, 245);
    else doc.setFillColor(...corPorIntensidade(pedidos, maxPedidos));
    for (const rings of polygons) for (const ring of rings) {
      if (ring.length < 2) continue;
      doc.lines(
        ring.slice(1).map((p, i) => [p.x - ring[i].x, p.y - ring[i].y] as [number, number]),
        ring[0].x,
        ring[0].y,
        [1, 1],
        'FD',
        true,
      );
    }
  }
  doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(...SUAVE);
  doc.text('menos', 20, 182);
  for (let i = 0; i < 20; i++) {
    const t = i / 19;
    doc.setFillColor(
      Math.round(235 + (VIOLETA[0] - 235) * t),
      Math.round(228 + (VIOLETA[1] - 228) * t),
      Math.round(253 + (VIOLETA[2] - 253) * t),
    ).rect(32 + i * 4.2, 178.6, 4.3, 3.5, 'F');
  }
  doc.text('mais', 120, 182);
}

function ranking(doc: jsPDF, data: DashboardPdfVisual): void {
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...TEXTO);
  doc.text('Ranking por UF', 158, 72);
  if (data.geografia.length === 0) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SUAVE);
    doc.text('Sem vendas com destino no período', 221.5, 125, { align: 'center' });
    return;
  }
  const ordenados = [...data.geografia].sort((a, b) => b.pedidos - a.pedidos).slice(0, 5);
  const max = Math.max(1, ...ordenados.map((item) => item.pedidos));
  ordenados.forEach((item, i) => {
    const y = 83 + i * 18;
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...TEXTO).text(item.uf, 158, y);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...SUAVE);
    doc.text(`${fmtInt(item.pedidos)} pedidos`, 274, y, { align: 'right' });
    doc.setFillColor(235, 231, 251).roundedRect(158, y + 4, 96, 3.5, 1, 1, 'F');
    doc.setFillColor(...corPorIntensidade(item.pedidos, max))
      .roundedRect(158, y + 4, 96 * item.pedidos / max, 3.5, 1, 1, 'F');
    doc.setTextColor(...SUAVE).text(`${item.participacao.toLocaleString('pt-BR', {
      maximumFractionDigits: 1,
    })}%`, 274, y + 7, { align: 'right' });
  });
  if (data.semLocalizacao > 0) {
    const sufixo = data.semLocalizacao === 1 ? 'pedido sem localização' : 'pedidos sem localização';
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...SUAVE);
    doc.text(`${fmtInt(data.semLocalizacao)} ${sufixo}`, 274, 177, { align: 'right' });
  }
}

export function desenharPaginaGeografia(
  doc: jsPDF,
  data: DashboardPdfVisual,
  emitidoEm: Date,
): void {
  cabecalho(doc, data, emitidoEm);
  liberacoes(doc, data);
  doc.setDrawColor(225, 230, 238).roundedRect(12, 56, 273, 134, 2, 2, 'S');
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXTO);
  doc.text('Vendas por estado', 17, 63);
  mapa(doc, data);
  ranking(doc, data);
  doc.setDrawColor(220, 226, 235).line(12, 197, 285, 197);
  doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...SUAVE);
  doc.text('Página 2 de 2', 12, 201);
  doc.text(`${data.periodo}  ·  ${data.canal}`, 148.5, 201, { align: 'center' });
  doc.text(`Emitido em ${emitidoEm.toLocaleString('pt-BR')}`, 285, 201, { align: 'right' });
}
