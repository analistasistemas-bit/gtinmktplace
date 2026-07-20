import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { desenharPaginaGeografia, projetarMapaBrasil } from '../pdf-dashboard-mapa';
import { dashboardPdfFixture } from './pdf-dashboard-fixture';

describe('projetarMapaBrasil', () => {
  it('projeta as 27 UFs dentro da área solicitada', () => {
    const area = { x: 12, y: 52, largura: 125, altura: 128 };
    const ufs = projetarMapaBrasil(area);
    expect(ufs.size).toBe(27);
    for (const polygons of ufs.values()) {
      for (const rings of polygons) for (const ring of rings) for (const p of ring) {
        expect(p.x).toBeGreaterThanOrEqual(area.x);
        expect(p.x).toBeLessThanOrEqual(area.x + area.largura);
        expect(p.y).toBeGreaterThanOrEqual(area.y);
        expect(p.y).toBeLessThanOrEqual(area.y + area.altura);
      }
    }
  });
});

it('desenha mapa, ranking limitado e liberações sem imagem', () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const addImage = vi.spyOn(doc, 'addImage');
  desenharPaginaGeografia(doc, dashboardPdfFixture(), new Date('2026-07-20T10:31:00-03:00'));
  const output = doc.output();
  expect(output).toContain('Liberações próximas');
  expect(output).toContain('Vendas por estado');
  expect(output).toContain('Página 2 de 2');
  expect(addImage).not.toHaveBeenCalled();
});

it('limita liberações a seis e o ranking a cinco UFs', () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const text = vi.spyOn(doc, 'text');
  desenharPaginaGeografia(doc, dashboardPdfFixture({
    liberacoes: Array.from({ length: 7 }, (_, i) => ({
      data: `0${i + 1}/09`,
      valor: 100 + i,
    })),
    geografia: ['MG', 'SP', 'PE', 'BA', 'PR', 'SC'].map((uf, i) => ({
      uf,
      pedidos: 10 - i,
      participacao: 30 - i,
    })),
  }), new Date('2026-07-20T10:31:00-03:00'));
  const textos = text.mock.calls.map(([valor]) => valor);
  expect(textos).toContain('06/09');
  expect(textos).not.toContain('07/09');
  expect(textos).toContain('PR');
  expect(textos).not.toContain('SC');
});

it('preserva datas curtas e percentuais já normalizados', () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const text = vi.spyOn(doc, 'text');
  desenharPaginaGeografia(doc, dashboardPdfFixture({
    liberacoes: [{ data: '18/08', valor: 319.55 }],
    geografia: [{ uf: 'MG', pedidos: 4, participacao: 44.4 }],
  }), new Date('2026-07-20T10:31:00-03:00'));
  expect(text).toHaveBeenCalledWith('18/08', expect.any(Number), expect.any(Number));
  expect(text).toHaveBeenCalledWith(
    '44,4%',
    expect.any(Number),
    expect.any(Number),
    expect.objectContaining({ align: 'right' }),
  );
});

it('informa pedidos sem localização', () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  desenharPaginaGeografia(
    doc,
    dashboardPdfFixture({ semLocalizacao: 1 }),
    new Date('2026-07-20T10:31:00-03:00'),
  );
  expect(doc.output()).toContain('1 pedido sem localização');
});

it.each([
  { patch: { liberacoes: [] }, texto: 'Nada a liberar no horizonte' },
  { patch: { geografia: [] }, texto: 'Sem vendas com destino no período' },
])('desenha estado vazio: $texto', ({ patch, texto }) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  desenharPaginaGeografia(doc, dashboardPdfFixture(patch), new Date('2026-07-20T10:31:00-03:00'));
  expect(doc.output()).toContain(texto);
});
