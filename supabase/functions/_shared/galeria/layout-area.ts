// Áreas da cena que o gerador deixa livres para o texto composto depois (R6.3). Fonte única: o prompt (edge) descreve
// a área com `areaTexto` e os layouts do front (`src/lib/galeria/layouts.ts`) só posicionam caixas dentro dos retângulos.
// Puro e sem imports. Coordenadas no arquivo final 1200×1540. Missão 1 (capa) e 7 (recorte) não têm cena com texto.

export interface RetanguloCena { x0: number; y0: number; x1: number; y1: number }

const AREAS: Record<number, { areaTexto: string; rects: RetanguloCena[] }> = {
  2: { areaTexto: 'the top 40% of the frame', rects: [{ x0: 0, y0: 0, x1: 1200, y1: 616 }] },
  // Topo: headline, sub e chip. Canto inferior esquerdo: a lupa (recorte da referência, Task 12).
  3: {
    areaTexto: 'the top 48% of the frame and the bottom-left corner (left 40%, bottom 38%)',
    rects: [{ x0: 0, y0: 0, x1: 1200, y1: 740 }, { x0: 0, y0: 955, x1: 480, y1: 1540 }],
  },
  4: { areaTexto: 'the top 26% and the left 65% of the frame', rects: [{ x0: 0, y0: 0, x1: 1200, y1: 400 }, { x0: 0, y0: 0, x1: 780, y1: 1540 }] },
  5: { areaTexto: 'the bottom 51% of the frame', rects: [{ x0: 0, y0: 760, x1: 1200, y1: 1540 }] },
  6: { areaTexto: 'the top 73% of the frame', rects: [{ x0: 0, y0: 0, x1: 1200, y1: 1120 }] },
}

export const areaCena = (missao: number): RetanguloCena[] => AREAS[missao]?.rects ?? []

/** `null` = missão sem área reservada (capa, recorte). */
export const layoutCena = (missao: number): { areaTexto: string } | null =>
  AREAS[missao] ? { areaTexto: AREAS[missao].areaTexto } : null
