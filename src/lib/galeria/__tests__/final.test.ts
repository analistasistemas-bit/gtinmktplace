import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montarArquivoFinal } from '../final';

// Canvas e Image simulados como em compor.test.ts (o jsdom não tem canvas).
let dims: Record<string, [number, number]>;
let ctx: Record<string, ReturnType<typeof vi.fn>>;
let pesoPorQualidade: (q: number) => number;
let qualidades: number[];

class FakeImage {
  crossOrigin: string | null = null;
  naturalWidth = 0; naturalHeight = 0;
  onload: (() => void) | null = null; onerror: ((e: unknown) => void) | null = null;
  set src(v: string) {
    const d = dims[v];
    if (!d) { setTimeout(() => this.onerror?.('x'), 0); return; }
    this.naturalWidth = d[0]; this.naturalHeight = d[1];
    setTimeout(() => this.onload?.(), 0);
  }
}

beforeEach(() => {
  qualidades = [];
  dims = { a: [1856, 2304], b: [1792, 2400], larga: [2400, 1000] };
  pesoPorQualidade = () => 400_000;
  ctx = { fillRect: vi.fn(), drawImage: vi.fn() } as never;
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, q?: number) {
    qualidades.push(q!);
    setTimeout(() => cb(new Blob([new Uint8Array(pesoPorQualidade(q!))], { type })), 0);
  };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('montarArquivoFinal', () => {
  it('1856×2304: JPEG, destino 1200×1540 e recorte lateral centrado', async () => {
    const b = await montarArquivoFinal('a', false);
    expect(b.type).toBe('image/jpeg');
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = ctx.drawImage.mock.calls[0];
    expect([dx, dy, dw, dh]).toEqual([0, 0, 1200, 1540]);
    expect(sx).toBeGreaterThan(0); expect(sy).toBe(0);
    expect(sw).toBeLessThan(1856); expect(sh).toBe(2304);
    expect(sx).toBe(Math.round((1856 - sw) / 2));
  });

  it('1792×2400 (3:4): corte na altura, centrado', async () => {
    await montarArquivoFinal('b', false);
    const [, sx, sy, sw, sh] = ctx.drawImage.mock.calls[0];
    expect(sx).toBe(0); expect(sw).toBe(1792);
    expect(sh).toBeLessThan(2400); expect(sy).toBeGreaterThan(0);
    expect(sy).toBe(Math.round((2400 - sh) / 2));
  });

  it('2400×1000 fora da capa: rejeita com corte', async () => {
    await expect(montarArquivoFinal('larga', false)).rejects.toThrow('corte');
  });

  it('2400×1000 na capa: fundo branco antes da imagem inteira, sem recorte', async () => {
    const b = await montarArquivoFinal('larga', true);
    expect(b.type).toBe('image/jpeg');
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(ctx.drawImage.mock.invocationCallOrder[0]);
    expect((ctx as never as { fillStyle: string }).fillStyle).toBe('#ffffff');
    const args = ctx.drawImage.mock.calls[0];
    expect(args).toHaveLength(5);
    const [, dx, dy, dw, dh] = args;
    expect([dx, dw, dh]).toEqual([0, 1200, 500]);
    expect(dy).toBe(520);
  });

  it('acima de 1 MB em todas as qualidades: rejeita com peso', async () => {
    pesoPorQualidade = () => 1_100_000;
    await expect(montarArquivoFinal('a', false)).rejects.toThrow('peso');
    expect(Math.min(...qualidades)).toBeCloseTo(0.6, 5);
  });

  it('cabe na segunda qualidade: resolve com 2 chamadas de toBlob', async () => {
    pesoPorQualidade = (q) => (q >= 0.92 ? 1_100_000 : 900_000);
    const b = await montarArquivoFinal('a', false);
    expect(b.size).toBe(900_000);
    expect(qualidades).toHaveLength(2);
    expect(qualidades[0]).toBe(0.92);
  });

  it('falha de carga: rejeita com carga', async () => {
    await expect(montarArquivoFinal('inexistente', false)).rejects.toThrow('carga');
  });
});
