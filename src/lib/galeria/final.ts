// ADR-0203: arquivo final = a imagem inteira do gerador, só recortada para 1200×1540 (nunca esticada, sem compor texto).
// Cross-origin: `crossOrigin = 'anonymous'` antes do `src`, senão o canvas fica sujo e `toBlob` lança SecurityError.
import { ALTURA_FINAL, LARGURA_FINAL, PESO_MAXIMO_FINAL, planejarCorte } from '../../../supabase/functions/_shared/galeria/corte';

const QUALIDADES = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6];

function carregar(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error('carga'));
    img.src = url;
  });
}

const toBlob = (canvas: HTMLCanvasElement, q: number): Promise<Blob> =>
  new Promise((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error('peso'))), 'image/jpeg', q));

/** Arquivo final para aprovar: JPEG 1200×1540 ≤ 1 MB a partir da imagem do gerador. Não compõe texto. */
export async function montarArquivoFinal(url: string, capa: boolean): Promise<Blob> {
  const img = await carregar(url);
  const w = img.naturalWidth; const h = img.naturalHeight;
  const p = planejarCorte(w, h, capa);
  if (p.modo === 'bloqueado') throw new Error('corte');

  const canvas = document.createElement('canvas');
  canvas.width = LARGURA_FINAL; canvas.height = ALTURA_FINAL;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('carga');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, LARGURA_FINAL, ALTURA_FINAL);

  if (p.modo === 'corte') ctx.drawImage(img, p.x, p.y, p.largura, p.altura, 0, 0, LARGURA_FINAL, ALTURA_FINAL);
  else {
    // Capa fora de proporção: imagem inteira, centralizada sobre branco.
    const s = Math.min(LARGURA_FINAL / w, ALTURA_FINAL / h);
    const dw = Math.round(w * s); const dh = Math.round(h * s);
    ctx.drawImage(img, Math.round((LARGURA_FINAL - dw) / 2), Math.round((ALTURA_FINAL - dh) / 2), dw, dh);
  }

  for (const q of QUALIDADES) {
    const b = await toBlob(canvas, q);
    if (b.size <= PESO_MAXIMO_FINAL) return b;
  }
  throw new Error('peso');
}
