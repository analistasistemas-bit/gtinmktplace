import { beforeEach, describe, expect, it, vi } from 'vitest';

// Simula o script atômico: lê (ausente = 0); se atual + n > teto devolve -1 sem escrever; senão soma, aplica o TTL
// quando a chave nasce e devolve o total.
const db = new Map<string, number>();
const ttl = new Map<string, number>();
let falhar = false;
let naoInteiro = false;

vi.mock('../../redis/client.ts', () => ({
  redisEvalInteiro: vi.fn(async (_script: string, chaves: string[], args: (string | number)[]) => {
    if (falhar) throw new Error('redis fora');
    if (naoInteiro) throw new Error('Redis EVAL: resposta inválida'); // como o cliente real
    const [k] = chaves;
    const [n, teto, t] = args.map(Number);
    const atual = db.get(k) ?? 0;
    if (atual + n > teto) return -1;
    db.set(k, atual + n);
    if (atual + n === n) ttl.set(k, t);
    return atual + n;
  }),
}));

const { LIMITES, reservarChamada, reservarFalhaIp, reservarLeituras, reservarTarifas } = await import('../limite.ts');
const { redisEvalInteiro } = await import('../../redis/client.ts');
const evalMock = vi.mocked(redisEvalInteiro);

const agora = new Date('2026-11-22T14:05:30.000Z');
const invalida = new Date('lixo');

beforeEach(() => {
  db.clear(); ttl.clear(); falhar = false; naoInteiro = false;
  evalMock.mockClear();
});

describe('LIMITES', () => {
  it('valores da fatia 1', () => {
    expect(LIMITES).toEqual({ chamadasMin: 60, falhasIpMin: 20, tarifasDia: 5000, leiturasDia: 3000 });
  });
});

describe('argumentos do script', () => {
  it('chave, n, teto e ttl de cada limite', async () => {
    await reservarChamada('c1', agora);
    await reservarFalhaIp('1.2.3.4', agora);
    await reservarTarifas('o1', 50, agora);
    const chamadas = evalMock.mock.calls.map(([script, chaves, args]) => {
      expect(typeof script).toBe('string');
      return [chaves, args];
    });
    expect(chamadas).toEqual([
      [['agt:ch:v1:c1:202611221405'], [1, 60, 120]],
      [['agt:ip:v1:1.2.3.4:202611221405'], [1, 20, 120]],
      [['agt:tar:v1:o1:20261122'], [50, 5000, 172800]],
    ]);
  });
});

describe('reservarChamada', () => {
  it('60ª ok, 61ª limite; contador para em 60', async () => {
    const r: string[] = [];
    for (let i = 0; i < 61; i++) r.push(await reservarChamada('c1', agora));
    expect(r).toEqual([...Array(60).fill('ok'), 'limite']);
    expect(db.get('agt:ch:v1:c1:202611221405')).toBe(60);
    expect(ttl.get('agt:ch:v1:c1:202611221405')).toBe(120);
  });

  it('conexões independentes; minuto seguinte reabre', async () => {
    for (let i = 0; i < 61; i++) await reservarChamada('c1', agora);
    expect(await reservarChamada('c2', agora)).toBe('ok');
    expect(await reservarChamada('c1', new Date('2026-11-22T14:06:00.000Z'))).toBe('ok');
  });

  it('eval lançando, resposta não inteira ou Date inválido → falha', async () => {
    expect(await reservarChamada('c1', invalida)).toBe('falha');
    naoInteiro = true;
    expect(await reservarChamada('c1', agora)).toBe('falha');
    falhar = true;
    expect(await reservarChamada('c1', agora)).toBe('falha');
  });
});

describe('reservarFalhaIp', () => {
  it('20ª ok, 21ª limite; contador para em 20', async () => {
    const r: string[] = [];
    for (let i = 0; i < 21; i++) r.push(await reservarFalhaIp('1.2.3.4', agora));
    expect(r).toEqual([...Array(20).fill('ok'), 'limite']);
    expect(db.get('agt:ip:v1:1.2.3.4:202611221405')).toBe(20);
  });

  it('eval lançando ou Date inválido → falha', async () => {
    expect(await reservarFalhaIp('1.2.3.4', invalida)).toBe('falha');
    falhar = true;
    expect(await reservarFalhaIp('1.2.3.4', agora)).toBe('falha');
  });
});

describe('reservarTarifas', () => {
  it('soma n de uma vez na chave do dia em BRT com TTL 2 dias', async () => {
    expect(await reservarTarifas('o1', 50, agora)).toBe('ok');
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(50);
    expect(ttl.get('agt:tar:v1:o1:20261122')).toBe(172800);
  });

  it('dia em BRT: 02:00 UTC ainda é o dia anterior', async () => {
    await reservarTarifas('o1', 1, new Date('2026-11-23T02:00:00.000Z'));
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(1);
  });

  it('4990 + 50 → limite com contador intacto; depois 10 → ok (5000)', async () => {
    expect(await reservarTarifas('o1', 4990, agora)).toBe('ok');
    expect(await reservarTarifas('o1', 50, agora)).toBe('limite');
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(4990);
    expect(await reservarTarifas('o1', 10, agora)).toBe('ok');
    expect(db.get('agt:tar:v1:o1:20261122')).toBe(5000);
  });

  it('n acima do teto (6000) → limite sem chamar o Redis', async () => {
    expect(await reservarTarifas('o1', 6000, agora)).toBe('limite');
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('eval lançando, resposta não inteira ou Date inválido → falha', async () => {
    expect(await reservarTarifas('o1', 5, invalida)).toBe('falha');
    naoInteiro = true;
    expect(await reservarTarifas('o1', 5, agora)).toBe('falha');
    falhar = true;
    expect(await reservarTarifas('o1', 5, agora)).toBe('falha');
  });

  it.each([0, -1, 1.5, NaN, 2 ** 53])('n inválido (%s) → falha sem tocar no Redis', async (n) => {
    expect(await reservarTarifas('o1', n, agora)).toBe('falha');
    expect(evalMock).not.toHaveBeenCalled();
  });
});

describe('reservarLeituras', () => {
  it('soma n na chave do dia em BRT da org, TTL 2 dias, teto 3000', async () => {
    expect(LIMITES.leiturasDia).toBe(3000);
    expect(await reservarLeituras('o1', 6, agora)).toBe('ok');
    expect(db.get('agt:lei:v1:o1:20261122')).toBe(6);
    expect(ttl.get('agt:lei:v1:o1:20261122')).toBe(172800);
  });

  it('2990 + 20 → limite com contador intacto', async () => {
    expect(await reservarLeituras('o1', 2990, agora)).toBe('ok');
    expect(await reservarLeituras('o1', 20, agora)).toBe('limite');
    expect(db.get('agt:lei:v1:o1:20261122')).toBe(2990);
  });

  it('n acima do teto → limite; n inválido → falha; sem tocar no Redis', async () => {
    expect(await reservarLeituras('o1', 3001, agora)).toBe('limite');
    expect(await reservarLeituras('o1', 0, agora)).toBe('falha');
    expect(await reservarLeituras('o1', 1.5, agora)).toBe('falha');
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('Redis falhando → falha', async () => {
    falhar = true;
    expect(await reservarLeituras('o1', 2, agora)).toBe('falha');
  });
});
