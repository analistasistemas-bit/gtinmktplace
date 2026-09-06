// Bug real 2026-09-06 (Kit Virtual): o POST /items/kits recusa com
// "thumbnail.secureUrl must not be null" quando o payload manda só `thumbnail.id` — a doc oficial
// mostra o `id` sozinho, mas o ML exige `secure_url` também. `GET /pictures/{id}` NÃO tem
// `secure_url` no topo (chaves reais: id, max_size, dominant_color, hash, crop, variations,
// status, origin) — só em `variations[].secure_url`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buscarSecureUrlFotoML } from '../fotos';

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
