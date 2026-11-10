// Áreas da cena que o gerador deixa livres para o texto composto depois (R6.3). Fonte única: o prompt (edge) descreve
// a área com `areaTexto` e os layouts do front (`src/lib/galeria/layouts.ts`) só posicionam caixas dentro dos retângulos.
// Puro e sem imports. Coordenadas no arquivo final 1200×1540. Missão 1 (capa) e 7 (recorte) não têm cena com texto.

export interface RetanguloCena { x0: number; y0: number; x1: number; y1: number }

const AREAS: Record<number, { areaTexto: string; rects: RetanguloCena[] }> = {
  2: { areaTexto: 'the top 40% of the frame', rects: [{ x0: 0, y0: 0, x1: 1200, y1: 616 }] },
  3: {
    areaTexto: 'the top 40% of the frame and the lower-left corner of the frame',
    rects: [{ x0: 0, y0: 0, x1: 1200, y1: 616 }, { x0: 0, y0: 1120, x1: 620, y1: 1540 }],
  },
  4: { areaTexto: 'the left 65% of the frame', rects: [{ x0: 0, y0: 0, x1: 780, y1: 1540 }] },
  5: { areaTexto: 'the bottom 44% of the frame', rects: [{ x0: 0, y0: 860, x1: 1200, y1: 1540 }] },
  6: { areaTexto: 'the left 65% of the frame', rects: [{ x0: 0, y0: 0, x1: 780, y1: 1540 }] },
}

export const areaCena = (missao: number): RetanguloCena[] => AREAS[missao]?.rects ?? []

/** `null` = missão sem área reservada (capa, recorte). */
export const layoutCena = (missao: number): { areaTexto: string } | null =>
  AREAS[missao] ? { areaTexto: AREAS[missao].areaTexto } : null
