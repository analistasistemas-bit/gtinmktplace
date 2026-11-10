// ADR-0201 (Task 10, R9.1): a imagem só é cobrada depois que o navegador a exibiu e ela não é branca/vazia.
// A URL é de outra origem (Storage): o <img> precisa de `crossOrigin="anonymous"`, senão `getImageData` lança
// SecurityError. Resultado em três estados: true (válida), false (decodificou e é chapada) e exceção (indeterminado:
// canvas indisponível ou contaminado) — quem chama trata a exceção como "não sei": nem confirma nem reporta.

/** Variância mínima da luminância (0–255²) entre as 64 amostras; branca/cinza chapada fica em ~0. */
export const LIMIAR_VARIANCIA = 10;
const GRADE = 8;

/**
 * Decodificou (`naturalWidth > 0`) e a variância de 64 pixels do ORIGINAL (grade 8×8 no centro de cada célula,
 * espalhada pela imagem inteira) passa do limiar.
 * ponytail: grade fixa — produto menor que uma célula (~150×190 px em 1200×1540) entre os pontos passaria como
 * chapado; trocar por amostragem mais densa se aparecer falso "inválida".
 */
export function imagemValida(img: HTMLImageElement): boolean {
  const w = img.naturalWidth; const h = img.naturalHeight;
  if (!img.complete || w <= 0 || h <= 0) return false;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas indisponível');
  ctx.drawImage(img, 0, 0);
  const lum: number[] = [];
  for (let i = 0; i < GRADE; i++) {
    for (let j = 0; j < GRADE; j++) {
      const x = Math.floor(((i + 0.5) * w) / GRADE); const y = Math.floor(((j + 0.5) * h) / GRADE);
      const d = ctx.getImageData(x, y, 1, 1).data;
      lum.push(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]);
    }
  }
  const media = lum.reduce((a, b) => a + b, 0) / lum.length;
  const variancia = lum.reduce((a, b) => a + (b - media) ** 2, 0) / lum.length;
  return variancia > LIMIAR_VARIANCIA;
}
