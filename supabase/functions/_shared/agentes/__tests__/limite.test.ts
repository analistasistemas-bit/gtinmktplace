import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = new Map<string, number>();
const ttl = new Map<string, number>();
let falhar = false;

vi.mock('../../redis/client.ts', () => ({
  redisIncrBy: vi.fn(async (k: string, n: number) => {
    if (falhar) throw new Error('redis fora');
    db.set(k, (db.get(k) ?? 0) + n);
    return db.get(k)!;
  }),
  redisExpire: vi.fn(async (k: string, s: number) => { ttl.set(k, s); return true; }),
}));

const { LIMITES, reservarChamada, reservarFalhaIp, reservarTarifas } = await import('../limite.ts');
const { redisIncrBy } = await import('../../redis/client.ts');

const agora = new Date('2026-11-22T14:05:30.000Z');

beforeEach(() => {
  db.clear(); ttl.clear(); falhar = false;
  vi.mocked(redisIncrBy).mockClear();
});

describe('LIMITES', () => {
  it('valores da fatia 1', () => {
    expect(LIMITES).toEqual({ chamadasMin: 60, falhasIpMin: 20, tarifasDia: 5000 });
  });
});

describe('reservarChamada', () => {
  it('60ª ok, 61ª limite; chave por minuto UTC com TTL 120 s', async () => {
    const r: string[] = [];
    for (let i = 0; i < 61; i++) r.push(await reservarChamada('c1', agora));
    expect(r).toEqual([...Array(60).fill('ok'), 'limite']);
    expect(ttl.get('agt:ch:v1:c1:202611221405')).toBe(120);
    expect(ttl.size).toBe(1);
  });

  it('conexões independentes; minuto seguinte reabre', async () => {
    for (let i = 0; i < 61; i++) await reservarChamada('c1', agora);
    expect(await reservarChamada('c2', agora)).toBe('ok');
    expect(await reservarChamada('c1', new Date('2026-11-22T14:06:00.000Z'))).toBe('ok');
  });

  it('Redis lançando → falha', async () => {
    falhar = true;
    expect(await reservarChamada('c1', agora)).toBe('falha');
  });
});

describe('reservarFalhaIp', () => {
  it('20ª ok, 21ª limite; chave por IP e minuto', async () => {
    const r: string[] = [];
    for (let i = 0; i < 21; i++) r.push(await reservarFalhaIp('1.2.3.4', agora));
    expect(r).toEqual([...Array(20).fill('ok'), 'limite']);
    expect(ttl.get('agt:ip:v1:1.2.3.4:202611221405')).toBe(120);
  });

  it('Redis lançando → falha', async () => {
    falhar = true;
    expect(await reservarFalhaIp('1.2.3.4', agora)).toBe('falha');
  });
});

describe('reservarTarifas', () => {
  it('soma n de uma vez na chave do dia em BRT com TTL 2 dias', async () => {
    expect(await reservarTarifas('o1', 50, agora)).toBe('ok');
    expect(vi.mocked(redisIncrBy)).toHaveBeenCalledWith('agt:tar:v1:o1:20261122', 50);
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(50);
    expect(ttl.get('agt:tar:v1:o1:20261122')).toBe(172800);
  });

  it('dia em BRT: 02:00 UTC ainda é o dia anterior', async () => {
    await reservarTarifas('o1', 1, new Date('2026-11-23T02:00:00.000Z'));
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(1);
  });

  it('teto 5000: exato ok, acima limite sem devolver', async () => {
    expect(await reservarTarifas('o1', 5000, agora)).toBe('ok');
    expect(await reservarTarifas('o1', 1, agora)).toBe('limite');
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(5001);
  });

  it.each([0, -1, 1.5, NaN])('n inválido (%s) → falha sem tocar no Redis', async (n) => {
    expect(await reservarTarifas('o1', n, agora)).toBe('falha');
    expect(vi.mocked(redisIncrBy)).not.toHaveBeenCalled();
  });

  it('Redis lançando → falha', async () => {
    falhar = true;
    expect(await reservarTarifas('o1', 5, agora)).toBe('falha');
  });
});
