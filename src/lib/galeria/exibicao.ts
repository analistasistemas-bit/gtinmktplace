// ADR-0201 (Task 10, R9.1): a imagem só é cobrada depois que o navegador a exibiu e ela não é branca/vazia.
// A URL é de outra origem (Storage): o <img> precisa de `crossOrigin="anonymous"`, senão `getImageData` lança
// SecurityError — quem chama trata a exceção como "não sei" (nem confirma nem reporta).

/** Variância mínima da luminância (0–255²) entre as 64 amostras; branca/cinza chapada fica em ~0. */
export const LIMIAR_VARIANCIA = 10;

/** Decodificou (`naturalWidth > 0`) e a variância de 64 pixels (8×8 reduzido) passa do limiar. */
export function imagemValida(img: HTMLImageElement): boolean {
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return false;
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, 8, 8);
  const { data } = ctx.getImageData(0, 0, 8, 8);
  const lum: number[] = [];
  for (let i = 0; i < data.length; i += 4) lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  const media = lum.reduce((a, b) => a + b, 0) / lum.length;
  const variancia = lum.reduce((a, b) => a + (b - media) ** 2, 0) / lum.length;
  return variancia > LIMIAR_VARIANCIA;
}
