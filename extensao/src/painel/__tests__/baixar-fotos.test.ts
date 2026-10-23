import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { MAX_BYTES_FOTO, MAX_FOTOS, montarZipDeFotos, urlDaFoto } from '../baixar-fotos';

const jpeg = (n = 32) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const id = (i: number) => `${100000 + i}-MLA11553756880${i % 10}_082026`;
const sinal = () => new AbortController().signal;

describe('baixar fotos em ZIP (Task 19)', () => {
  it('ZIP com as fotos na ordem da galeria; falha não muda a numeração das demais', async () => {
    const buscar = vi.fn(async (url: string) => (url === urlDaFoto(id(2)) ? new Response('x', { status: 404 }) : new Response(jpeg())));
    const r = await montarZipDeFotos([id(1), id(2), id(3)], { sinal: sinal(), buscar: buscar as never });
    expect(r).toMatchObject({ incluidas: 2, falhas: [2], alemDoLimite: 0, alemDoTamanho: 0 });
    expect(Object.keys(unzipSync(r.zip!)).sort()).toEqual(['01.jpg', '03.jpg']);
    expect(buscar).toHaveBeenCalledWith(urlDaFoto(id(1)), expect.objectContaining({ credentials: 'omit' }));
  });

  it('id fora do formato não vira URL; resposta que não é JPEG ou passa do teto não entra; nenhuma foto → sem ZIP', async () => {
    const buscar = vi.fn(async (url: string) => new Response(url.includes(id(1)) ? new TextEncoder().encode('<html>') : new Uint8Array(MAX_BYTES_FOTO + 1)));
    const r = await montarZipDeFotos(['../x', id(1), id(2)], { sinal: sinal(), buscar: buscar as never });
    expect(r).toMatchObject({ zip: null, incluidas: 0, falhas: [1, 2, 3] });
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it(`no máximo ${MAX_FOTOS} fotos; as demais contam como cortadas`, async () => {
    const buscar = vi.fn(async () => new Response(jpeg()));
    const r = await montarZipDeFotos(Array.from({ length: MAX_FOTOS + 3 }, (_, i) => id(i)), { sinal: sinal(), buscar: buscar as never });
    expect(r).toMatchObject({ incluidas: MAX_FOTOS, alemDoLimite: 3, alemDoTamanho: 0 });
  });

  it('cancelar interrompe o download inteiro', async () => {
    const c = new AbortController();
    const buscar = vi.fn(async (_u: string, init: RequestInit) => {
      c.abort();
      if (init.signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      return new Response(jpeg());
    });
    await expect(montarZipDeFotos([id(1), id(2)], { sinal: c.signal, buscar: buscar as never })).rejects.toBeDefined();
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});
