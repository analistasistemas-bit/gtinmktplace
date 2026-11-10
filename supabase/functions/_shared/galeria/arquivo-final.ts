// ADR-0201 (Task 12, R9.1): conferência no servidor do arquivo final composto no navegador. Os bytes vêm do usuário
// (fronteira de confiança): formato e peso antes de decodificar; decodificação limitada em resolução e memória.
// "Não branco" = mesmo critério do navegador (`amostra.ts`).
import * as jpeg from 'npm:jpeg-js@0.4.4';
import { ALTURA_FINAL, LARGURA_FINAL, PESO_MAXIMO_FINAL } from './corte.ts';
import { LIMIAR_VARIANCIA, variancia64 } from './amostra.ts';

export type ErroArquivoFinal = 'formato' | 'dimensoes' | 'peso' | 'branca';

/** [] = arquivo aceito. */
export function validarArquivoFinal(bytes: Uint8Array): ErroArquivoFinal[] {
  if (!(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return ['formato'];
  if (bytes.length > PESO_MAXIMO_FINAL) return ['peso'];
  let img: { width: number; height: number; data: Uint8Array };
  try {
    // 1200×1540 = 1,85 MP; RGBA ≈ 7,4 MB.
    img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 2, maxMemoryUsageInMB: 64 });
  } catch (e) {
    return [/maxResolutionInMP|memory/i.test((e as Error).message) ? 'dimensoes' : 'formato'];
  }
  if (img.width !== LARGURA_FINAL || img.height !== ALTURA_FINAL) return ['dimensoes'];
  const v = variancia64(img.width, img.height, (x, y) => {
    const i = (y * img.width + x) * 4;
    return img.data.subarray(i, i + 3);
  });
  return v > LIMIAR_VARIANCIA ? [] : ['branca'];
}
