// ADR-0200, Adendo 1: decodifica PNG/JPEG em pixels para amostrar a cor (ver `cor.ts`). JS puro (sem wasm).
// Isolado aqui porque os testes (vitest) não resolvem `npm:`; o handler mocka este módulo.
import jpeg from 'npm:jpeg-js@0.4.4';
import { decode as decodificarPng } from 'npm:fast-png@6.2.0';
import type { Pixels } from './cor.ts';

/**
 * Pixels de PNG (8 bits) ou JPEG; outro formato, imagem acima de 4 MP ou erro → null (a cor fica sem amostra).
 * ponytail: teto de 4 MP pelo limite de CPU da edge; foto maior fica sem hex amostrado.
 */
export function decodificar(b: Uint8Array): Pixels | null {
  try {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      const p = decodificarPng(b);
      if (p.depth !== 8 || p.width * p.height > 4_000_000) return null;
      return { largura: p.width, altura: p.height, rgba: p.data as Uint8Array, canais: p.channels };
    }
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) {
      const j = jpeg.decode(b, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 128 });
      return { largura: j.width, altura: j.height, rgba: j.data, canais: 4 };
    }
  } catch { /* formato ilegível: sem amostra */ }
  return null;
}
