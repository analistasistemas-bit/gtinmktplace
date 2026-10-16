import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
vi.stubGlobal('crypto', webcrypto);

const range = vi.fn();
const download = vi.fn();
const chain: Record<string, unknown> = {};
for (const k of ['select', 'eq', 'gte', 'lt', 'order']) chain[k] = vi.fn(() => chain);
chain.range = (de: number, ate: number) => range(de, ate);
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: vi.fn(() => chain),
  storage: { from: vi.fn(() => ({ download: (p: string, o: unknown, f: { signal: AbortSignal }) => download(p, o, f) })) },
} }));
import { limitesMesSP, listarNotasCompraMes, sha256Hex, baixarXmlCompra, baixarXmlsCompra } from '../compras-fonte';
import { row } from './fixtures-compras';

const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e]);   // BOM + "<a/>"
const H = createHash('sha256').update(bom).digest('hex');                // oráculo independente
const sinal = () => new AbortController().signal;
beforeEach(() => { range.mockReset(); download.mockReset(); });

describe('limitesMesSP (R3: offset explícito, não depende do fuso do processo)', () => {
  it('outubro e dezembro', () => {
    expect(limitesMesSP('2026-10')).toEqual({ de: '2026-10-01T03:00:00.000Z', ate: '2026-11-01T03:00:00.000Z' });
    expect(limitesMesSP('2026-12')).toEqual({ de: '2026-12-01T03:00:00.000Z', ate: '2027-01-01T03:00:00.000Z' });
  });
});

describe('listarNotasCompraMes', () => {
  it('pagina até o fim, com filtro de org, limites, ordem e ranges', async () => {
    range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => row({ n: i + 1 })), error: null })
      .mockResolvedValueOnce({ data: [row({ n: 2001 })], error: null });
    expect(await listarNotasCompraMes('2026-10', 'org-1')).toHaveLength(1001);
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(chain.eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(chain.gte).toHaveBeenCalledWith('emitida_em', '2026-10-01T03:00:00.000Z');
    expect(chain.lt).toHaveBeenCalledWith('emitida_em', '2026-11-01T03:00:00.000Z');
    expect(chain.order).toHaveBeenCalledWith('emitida_em');
    expect(chain.order).toHaveBeenCalledWith('id');
  });
  it('falha numa página intermediária aborta', async () => {
    range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => row({ n: i + 1 })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    await expect(listarNotasCompraMes('2026-10', 'org-1')).rejects.toThrow('timeout');
  });
});

describe('baixarXmlCompra', () => {
  it('hash é dos bytes (com BOM), bate com o oráculo, e os bytes voltam inteiros', async () => {
    expect(await sha256Hex(bom)).toBe(H);
    download.mockResolvedValueOnce({ data: new Blob([bom]), error: null });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal())).toEqual({ tipo: 'ok', bytes: bom });
    expect(download.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
  it('divergente, sem hash, erro do storage, rejeição de rede e timeout', async () => {
    download.mockResolvedValueOnce({ data: new Blob([bom]), error: null });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: 'b'.repeat(64) }), sinal())).toEqual({ tipo: 'divergente' });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: null }), sinal())).toEqual({ tipo: 'sem_hash' });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: 'xyz' }), sinal())).toEqual({ tipo: 'sem_hash' });
    download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal())).toEqual({ tipo: 'indisponivel', motivo: 'Object not found' });
    download.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal())).toEqual({ tipo: 'indisponivel', motivo: 'Failed to fetch' });
    download.mockImplementationOnce((_p: string, _o: unknown, f: { signal: AbortSignal }) => new Promise((_, rej) => f.signal.addEventListener('abort', () => rej(new DOMException('a', 'AbortError')))));
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal(), 20)).toEqual({ tipo: 'indisponivel', motivo: 'tempo esgotado' });
  });
  it('timeout cobre a leitura dos bytes; cancelamento externo rejeita com AbortError', async () => {
    download.mockResolvedValueOnce({ data: { arrayBuffer: () => new Promise(() => {}) }, error: null });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal(), 20)).toEqual({ tipo: 'indisponivel', motivo: 'tempo esgotado' });
    const ac = new AbortController();
    download.mockImplementationOnce(() => new Promise(() => {}));
    const p = baixarXmlCompra(row({ n: 1, xml_sha256: H }), ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('baixarXmlsCompra', () => {
  it('no máximo 4 em paralelo, inclusive após timeouts; progresso; uma falha não derruba as outras', async () => {
    // Determinístico: timers falsos + digest mockado; só os 4 primeiros dependem do relógio (o timeout).
    vi.useFakeTimers();
    const dig = createHash('sha256').update(bom).digest();
    const spy = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(dig.buffer.slice(dig.byteOffset, dig.byteOffset + dig.byteLength));
    try {
      let ativos = 0; let pico = 0; let k = 0;
      download.mockImplementation((_p: string, _o: unknown, f: { signal: AbortSignal }) => {
        ativos += 1; pico = Math.max(pico, ativos);
        const i = k++;
        return new Promise((res, rej) => {
          let feito = false;
          const fim = () => { if (!feito) { feito = true; ativos -= 1; } };
          f.signal.addEventListener('abort', () => { fim(); rej(new DOMException('a', 'AbortError')); });
          if (i < 4) return;                              // os 4 primeiros só terminam pelo timeout
          queueMicrotask(() => {
            fim();
            if (i === 5) rej(new TypeError('Failed to fetch'));
            else res({ data: { arrayBuffer: async () => bom.buffer.slice(0) }, error: null });
          });
        });
      });
      const notas = Array.from({ length: 10 }, (_, i) => row({ n: i + 1, xml_sha256: H }));
      const prog: number[] = [];
      const pendente = baixarXmlsCompra(notas, sinal(), (f) => prog.push(f), 4, 15);
      await vi.advanceTimersByTimeAsync(15);   // estoura só os 4 primeiros; os demais terminam em microtasks
      const r = await pendente;
      const vals = [...r.values()];
      expect(pico).toBe(4);
      expect(r.size).toBe(10);
      expect(vals.filter((x) => x.tipo === 'indisponivel' && x.motivo === 'tempo esgotado')).toHaveLength(4);
      expect(vals.filter((x) => x.tipo === 'ok')).toHaveLength(5);
      expect(r.get('id-6')).toEqual({ tipo: 'indisponivel', motivo: 'Failed to fetch' });
      expect(prog.at(-1)).toBe(10);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
  it('cancelamento antes e durante', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(baixarXmlsCompra([row({ n: 1 })], ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    download.mockImplementation(() => new Promise(() => {}));
    const ac2 = new AbortController();
    const p = baixarXmlsCompra([row({ n: 1, xml_sha256: H }), row({ n: 2, xml_sha256: H })], ac2.signal);
    ac2.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
