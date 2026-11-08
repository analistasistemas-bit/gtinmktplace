import { describe, expect, it, vi } from 'vitest';
import { lerStatusML, lerStatusMLEstrito, SemAcessoStatusML } from '../ml-status.ts';

const API = 'https://api.mercadolibre.com';
const resp = (status: number, corpo?: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });

describe('lerStatusML', () => {
  it('200 active → ativo; URL do bulk e Bearer', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 200, body: { id: 'MLB1', status: 'active', sub_status: [] } }]));
    expect(await lerStatusML('tok', 'MLB1', f)).toBe('ativo');
    expect(f).toHaveBeenCalledWith(`${API}/items/bulk?ids=MLB1&attributes=status_code,body.id,body.status,body.sub_status`,
      { headers: { Authorization: 'Bearer tok' } });
  });

  it('paused + forbidden → moderado', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 200, body: { id: 'MLB1', status: 'paused', sub_status: ['forbidden'] } }]));
    expect(await lerStatusML('tok', 'MLB1', f)).toBe('moderado');
  });

  it('404 no envelope → null', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 404 }]));
    expect(await lerStatusML('tok', 'MLB1', f)).toBeNull();
  });

  it('HTTP 403 → SemAcessoStatusML', async () => {
    const f = vi.fn().mockResolvedValue(resp(403));
    await expect(lerStatusML('tok', 'MLB1', f)).rejects.toBeInstanceOf(SemAcessoStatusML);
  });

  it('HTTP 200 com status_code 403 no envelope → SemAcessoStatusML', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 403 }]));
    await expect(lerStatusML('tok', 'MLB1', f)).rejects.toBeInstanceOf(SemAcessoStatusML);
  });

  it('HTTP 500 → Error comum (não fatal)', async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    const e = await lerStatusML('tok', 'MLB1', f).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(SemAcessoStatusML);
  });
});

// ADR-0199 (Task 6, fix round 2): variante só para kit com variação. A original segue igual (testes acima).
describe('lerStatusMLEstrito', () => {
  const env = (x: unknown) => vi.fn().mockResolvedValue(resp(200, x));
  it('200 com o id pedido → status; 404 confirmado → null', async () => {
    expect(await lerStatusMLEstrito('tok', 'MLB1', env([{ status_code: 200, body: { id: 'MLB1', status: 'active', sub_status: [] } }]))).toBe('ativo');
    expect(await lerStatusMLEstrito('tok', 'MLB1', env([{ status_code: 404 }]))).toBeNull();
  });
  it.each([
    ['envelope com código 500', [{ status_code: 500 }]],
    ['resposta vazia', []],
    ['resposta não-lista', { erro: 'x' }],
    ['id divergente', [{ status_code: 200, body: { id: 'MLB9', status: 'active' } }]],
    ['200 sem body', [{ status_code: 200 }]],
  ])('%s → lança (não é confirmação)', async (_n, corpo) => {
    const e = await lerStatusMLEstrito('tok', 'MLB1', env(corpo)).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(SemAcessoStatusML);
  });
  it('403 no envelope → SemAcessoStatusML', async () => {
    await expect(lerStatusMLEstrito('tok', 'MLB1', env([{ status_code: 403 }]))).rejects.toBeInstanceOf(SemAcessoStatusML);
  });
  it('regressão: a original continua devolvendo null para envelope 500', async () => {
    expect(await lerStatusML('tok', 'MLB1', env([{ status_code: 500 }]))).toBeNull();
  });
});
