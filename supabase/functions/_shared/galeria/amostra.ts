// Critério "imagem não branca" (R9.1), fonte única do navegador (`src/lib/galeria/exibicao.ts`) e da edge
// (`arquivo-final.ts`): variância da luminância de 64 pixels do ORIGINAL (grade 8×8, centro de cada célula).
// Puro e sem imports.

/** Variância mínima da luminância (0–255²) entre as 64 amostras; branca/cinza chapada fica em ~0. */
export const LIMIAR_VARIANCIA = 10
const GRADE = 8

/**
 * `pixel(x, y)` devolve [r, g, b, …] do pixel. ponytail: grade fixa — produto menor que uma célula (~150×190 px em
 * 1200×1540) entre os pontos passaria como chapado; trocar por amostragem mais densa se aparecer falso "inválida".
 */
export function variancia64(w: number, h: number, pixel: (x: number, y: number) => ArrayLike<number>): number {
  const lum: number[] = []
  for (let i = 0; i < GRADE; i++) {
    for (let j = 0; j < GRADE; j++) {
      const d = pixel(Math.floor(((i + 0.5) * w) / GRADE), Math.floor(((j + 0.5) * h) / GRADE))
      lum.push(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2])
    }
  }
  const media = lum.reduce((a, b) => a + b, 0) / lum.length
  return lum.reduce((a, b) => a + (b - media) ** 2, 0) / lum.length
}
