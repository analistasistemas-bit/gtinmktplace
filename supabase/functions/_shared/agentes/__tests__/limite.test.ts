import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = new Map<string, number>();
const ttl = new Map<string, number>();
let falhar = false;
let falharExpire = false;
let falharDecr = false;

vi.mock('../../redis/client.ts', () => ({
  redisIncrBy: vi.fn(async (k: string, n: number) => {
    if (falhar) throw new Error('redis fora');
    db.set(k, (db.get(k) ?? 0) + n);
    return db.get(k)!;
  }),
  redisDecrBy: vi.fn(async (k: string, n: number) => {
    if (falharDecr) throw new Error('redis fora');
    db.set(k, (db.get(k) ?? 0) - n);
    return db.get(k)!;
  }),
  redisExpire: vi.fn(async (k: string, s: number) => {
    if (falharExpire) throw new Error('redis fora');
    ttl.set(k, s);
    return true;
  }),
}));

const { LIMITES, reservarChamada, reservarFalhaIp, reservarTarifas } = await import('../limite.ts');
const { redisDecrBy, redisExpire, redisIncrBy } = await import('../../redis/client.ts');

const agora = new Date('2026-11-22T14:05:30.000Z');
const invalida = new Date('lixo');

beforeEach(() => {
  db.clear(); ttl.clear(); falhar = false; falharExpire = false; falharDecr = false;
  vi.mocked(redisIncrBy).mockClear();
  vi.mocked(redisDecrBy).mockClear();
  vi.mocked(redisExpire).mockClear();
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
    expect(vi.mocked(redisExpire)).toHaveBeenCalledTimes(1); // só quando a chave nasce
    expect(vi.mocked(redisDecrBy)).not.toHaveBeenCalled(); // janela por minuto não devolve
  });

  it('EXPIRE lançando → falha; Date inválido → falha', async () => {
    falharExpire = true;
    expect(await reservarChamada('c1', agora)).toBe('falha');
    expect(await reservarChamada('c1', invalida)).toBe('falha');
    expect(await reservarFalhaIp('1.2.3.4', invalida)).toBe('falha');
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

  it('acima do teto devolve o n: 4990 + 50 → limite e volta a 4990; depois 10 → ok (5000)', async () => {
    expect(await reservarTarifas('o1', 4990, agora)).toBe('ok');
    expect(await reservarTarifas('o1', 50, agora)).toBe('limite');
    expect(vi.mocked(redisDecrBy)).toHaveBeenCalledWith('agt:tar:v1:o1:20261122', 50);
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(4990);
    expect(await reservarTarifas('o1', 10, agora)).toBe('ok');
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(5000);
    expect(vi.mocked(redisExpire)).toHaveBeenCalledTimes(1);
  });

  it('n acima do teto (6000) → limite sem chamar o Redis', async () => {
    expect(await reservarTarifas('o1', 6000, agora)).toBe('limite');
    expect(vi.mocked(redisIncrBy)).not.toHaveBeenCalled();
  });

  it('DECRBY lançando → falha', async () => {
    await reservarTarifas('o1', 4990, agora);
    falharDecr = true;
    expect(await reservarTarifas('o1', 50, agora)).toBe('falha');
  });

  it('EXPIRE lançando ou Date inválido → falha', async () => {
    expect(await reservarTarifas('o1', 5, invalida)).toBe('falha');
    falharExpire = true;
    expect(await reservarTarifas('o1', 5, agora)).toBe('falha');
  });

  it.each([0, -1, 1.5, NaN, 2 ** 53])('n inválido (%s) → falha sem tocar no Redis', async (n) => {
    expect(await reservarTarifas('o1', n, agora)).toBe('falha');
    expect(vi.mocked(redisIncrBy)).not.toHaveBeenCalled();
  });

  it('Redis lançando → falha', async () => {
    falhar = true;
    expect(await reservarTarifas('o1', 5, agora)).toBe('falha');
  });
});
