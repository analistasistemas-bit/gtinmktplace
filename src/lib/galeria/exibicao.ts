// ADR-0201 (Task 10, R9.1): a imagem só é cobrada depois que o navegador a exibiu e ela não é branca/vazia.
// A URL é de outra origem (Storage): o <img> precisa de `crossOrigin="anonymous"`, senão `getImageData` lança
// SecurityError. Resultado em três estados: true (válida), false (decodificou e é chapada) e exceção (indeterminado:
// canvas indisponível ou contaminado) — quem chama trata a exceção como "não sei": nem confirma nem reporta.
// O critério (64 pixels, limiar) é o mesmo da edge `galeria-aprovar` (Task 12): `_shared/galeria/amostra.ts`.
import { LIMIAR_VARIANCIA, variancia64 } from '../../../supabase/functions/_shared/galeria/amostra';

/** Decodificou (`naturalWidth > 0`) e a variância de 64 pixels do ORIGINAL passa do limiar. */
export function imagemValida(img: HTMLImageElement): boolean {
  const w = img.naturalWidth; const h = img.naturalHeight;
  if (!img.complete || w <= 0 || h <= 0) return false;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas indisponível');
  ctx.drawImage(img, 0, 0);
  return variancia64(w, h, (x, y) => ctx.getImageData(x, y, 1, 1).data) > LIMIAR_VARIANCIA;
}
