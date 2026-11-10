// Bug real 2026-09-06 (Kit Virtual): o POST /items/kits recusa com
// "thumbnail.secureUrl must not be null" quando o payload manda só `thumbnail.id` — a doc oficial
// mostra o `id` sozinho, mas o ML exige `secure_url` também. `GET /pictures/{id}` NÃO tem
// `secure_url` no topo (chaves reais: id, max_size, dominant_color, hash, crop, variations,
// status, origin) — só em `variations[].secure_url`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buscarSecureUrlFotoML, subirFotoMLArquivo } from '../fotos';

afterEach(() => vi.unstubAllGlobals());

function resp(json: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(json), { status }));
}

describe('buscarSecureUrlFotoML', () => {
  it('extrai secure_url de variations[0], não da raiz', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('https://api.mercadolibre.com/pictures/981862-MLA1');
      return resp({
        id: '981862-MLA1', max_size: '500x500', dominant_color: '#fff', hash: 'x',
        crop: null, status: 'active', origin: 'seller',
        variations: [{ size: '500x500', secure_url: 'https://http2.mlstatic.com/foto-F.jpg' }],
      });
    }));
    expect(await buscarSecureUrlFotoML('tok', '981862-MLA1')).toBe('https://http2.mlstatic.com/foto-F.jpg');
  });

  it('ML responde erro → lança (quem chama trata como falha_foto)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'not found' }, 404)));
    await expect(buscarSecureUrlFotoML('tok', 'sumida')).rejects.toThrow(/404/);
  });

  it('resposta sem variations/secure_url → lança (nunca devolve string vazia/undefined)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ id: '981862-MLA1', variations: [] })));
    await expect(buscarSecureUrlFotoML('tok', '981862-MLA1')).rejects.toThrow(/secure_url/);
  });
});

// Galeria da cor (Task 13): contrato medido no ensaio da Task 1 — POST /pictures/items/upload, multipart `file`,
// User-Agent de navegador; resposta 201 com id, status ACTIVE e variations[].secure_url (tamanhos, sem id).
describe('subirFotoMLArquivo', () => {
  const comoFetch = (f: unknown) => f as typeof fetch;

  it('envia FormData com file (bytes e mime) e devolve id + pronta', async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify({
        id: '755051-MLB119404244560_112026', status: 'ACTIVE', max_size: '859x906',
        variations: [{ size: '500x500', url: 'http://x', secure_url: 'https://x/D_NQ_NP_755051-F.jpg' }],
      }), { status: 201 });
    });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect(await subirFotoMLArquivo('tok', bytes, 'image/jpeg', comoFetch(f)))
      .toEqual({ id: '755051-MLB119404244560_112026', pronta: true });
    const { url, init } = chamadas[0];
    expect(url).toBe('https://api.mercadolibre.com/pictures/items/upload');
    expect(init.method).toBe('POST');
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe('Bearer tok');
    expect(h.get('user-agent')).toBe('Mozilla/5.0');
    expect(h.get('content-type')).toBeNull();
    const file = (init.body as FormData).get('file') as File;
    expect(file.type).toBe('image/jpeg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it('sem status ACTIVE ou sem secure_url → pronta false', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'P1', status: 'processing', variations: [{ secure_url: 'https://x' }] }), { status: 201 }));
    expect(await subirFotoMLArquivo('tok', new Uint8Array([1]), 'image/jpeg', comoFetch(f))).toEqual({ id: 'P1', pronta: false });
    const g = vi.fn(async () => new Response(JSON.stringify({ id: 'P1', status: 'active', variations: [] }), { status: 201 }));
    expect(await subirFotoMLArquivo('tok', new Uint8Array([1]), 'image/jpeg', comoFetch(g))).toEqual({ id: 'P1', pronta: false });
  });

  it('HTTP de erro lança com status; resposta sem id lança', async () => {
    const f = vi.fn(async () => new Response('{"message":"x"}', { status: 503 }));
    await expect(subirFotoMLArquivo('tok', new Uint8Array([1]), 'image/jpeg', comoFetch(f))).rejects.toMatchObject({ status: 503 });
    const g = vi.fn(async () => new Response('{"status":"ACTIVE"}', { status: 201 }));
    await expect(subirFotoMLArquivo('tok', new Uint8Array([1]), 'image/jpeg', comoFetch(g))).rejects.toThrow(/id/);
  });
});
