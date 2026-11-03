// Cotas da fatia 2 por PÁGINA (Revisão 03/11-b): Redis falso em memória atrás do fetch
// do cliente REST real, para contar comandos de verdade (Upstash cobra por comando).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chaveOrcamentoMl, chavePagina, devolverOrcamentoMl, LIMITE_ORCAMENTO_ML_MIN, LIMITE_PAGINAS_MIN, reservarOrcamentoMl, reservarPagina,
} from '../cotas-busca.ts';

const db = new Map<string, number>();
const ttl = new Map<string, number>();
let comandos: unknown[][] = [];
let respostaForcada: { result?: unknown; status?: number } | null = null;

const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  const cmd = JSON.parse(init.body as string) as [string, string, number];
  comandos.push(cmd);
  if (respostaForcada) {
    const { result, status = 200 } = respostaForcada;
    return new Response(status === 200 ? JSON.stringify({ result }) : 'erro', { status });
  }
  const [op, k, n] = cmd;
  let result: unknown;
  if (op === 'INCRBY') { db.set(k, (db.get(k) ?? 0) + n); result = db.get(k); }
  else if (op === 'DECRBY') { db.set(k, (db.get(k) ?? 0) - n); result = db.get(k); }
  else if (op === 'EXPIRE') { ttl.set(k, n); result = db.has(k) ? 1 : 0; }
  else throw new Error(`comando inesperado ${op}`);
  return new Response(JSON.stringify({ result }), { status: 200 });
});

const agora = new Date('2026-11-03T14:05:30.123Z');
const ops = () => comandos.map((c) => c[0]);

beforeEach(() => {
  db.clear(); ttl.clear(); comandos = []; respostaForcada = null;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'UPSTASH_REDIS_REST_URL' ? 'https://r.test' : 'tok') } });
});

describe('chaves', () => {
  it('janela de minuto UTC versionada; global sem tenant', () => {
    expect(chavePagina('org1', 'u1', agora)).toBe('ext:enr:pagina:v1:org1:u1:202611031405');
    expect(chaveOrcamentoMl(agora)).toBe('ext:mlapp:202611031405');
    expect(LIMITE_PAGINAS_MIN).toBe(20);
    expect(LIMITE_ORCAMENTO_ML_MIN).toBe(1000);
  });
});

describe('reservarPagina (1 unidade por pedido não vazio)', () => {
  it('20 páginas aceitas, a 21ª recusada; só INCRBY (+ EXPIRE 120 s quando nasce), nunca DECRBY', async () => {
    const r: string[] = [];
    for (let i = 0; i < 21; i++) r.push(await reservarPagina('org1', 'u1', agora));
    expect(r).toEqual([...Array(20).fill('ok'), 'limite']);
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', ...Array(20).fill('INCRBY')]);
    expect(comandos[0]).toEqual(['INCRBY', 'ext:enr:pagina:v1:org1:u1:202611031405', 1]);
    expect(ttl.get('ext:enr:pagina:v1:org1:u1:202611031405')).toBe(120);
  });

  it('usuários e orgs independentes', async () => {
    for (let i = 0; i < 20; i++) await reservarPagina('org1', 'u1', agora);
    expect(await reservarPagina('org1', 'u2', agora)).toBe('ok');
    expect(await reservarPagina('org2', 'u1', agora)).toBe('ok');
    expect(await reservarPagina('org1', 'u1', agora)).toBe('limite');
  });

  it('minuto UTC seguinte reabre a janela', async () => {
    for (let i = 0; i < 21; i++) await reservarPagina('org1', 'u1', agora);
    expect(await reservarPagina('org1', 'u1', new Date('2026-11-03T14:06:00.000Z'))).toBe('ok');
  });

  it('conta os comandos emitidos', async () => {
    const c = { comandosRedis: 0 };
    await reservarPagina('org1', 'u1', agora, c);
    await reservarPagina('org1', 'u1', agora, c);
    expect(c.comandosRedis).toBe(comandos.length);
    expect(c.comandosRedis).toBe(3);
  });

  it.each([{ result: null }, { result: 'lixo' }, { status: 500 }])('Redis inválido/indisponível → recusada (fail-closed) %j', async (resp) => {
    respostaForcada = resp;
    expect(await reservarPagina('org1', 'u1', agora)).toBe('falha');
  });
});

describe('orçamento global do ML', () => {
  it('teto 1000 compartilhado entre tenants; excedente devolvido', async () => {
    const a = await reservarOrcamentoMl(900, agora);
    const b = await reservarOrcamentoMl(200, agora);
    expect(a).toEqual({ concedidas: 900, chave: 'ext:mlapp:202611031405' });
    expect(b).toEqual({ concedidas: 100, chave: 'ext:mlapp:202611031405' });
    expect(db.get('ext:mlapp:202611031405')).toBe(1000);
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY', 'DECRBY']);
  });

  it.each([{ result: null }, { result: 'lixo' }, { status: 503 }])('Redis inválido → 0 concedidas (fail-closed) %j', async (resp) => {
    respostaForcada = resp;
    expect(await reservarOrcamentoMl(10, agora)).toEqual({ concedidas: 0, chave: 'ext:mlapp:202611031405' });
  });

  it('devolver: só as não despachadas, na chave original, uma vez', async () => {
    const r = await reservarOrcamentoMl(10, agora);
    comandos = [];
    // devolver não recebe relógio: mesmo que o minuto vire, vai à chave gravada na reserva
    expect(await devolverOrcamentoMl(r, 4, agora)).toBe(4);
    expect(comandos).toEqual([['DECRBY', 'ext:mlapp:202611031405', 4]]);
    expect(await devolverOrcamentoMl(r, 4, agora)).toBe(0);
    expect(comandos).toHaveLength(1);
    expect(db.get('ext:mlapp:202611031405')).toBe(6);
  });

  it('devolver nunca excede o que a reserva recebeu; nada a devolver = sem comando', async () => {
    db.set('ext:mlapp:202611031405', 995);
    const r = await reservarOrcamentoMl(10, agora); // concede 5
    comandos = [];
    expect(await devolverOrcamentoMl(r, 10, agora)).toBe(5);
    expect(comandos).toEqual([['DECRBY', 'ext:mlapp:202611031405', 5]]);
    const vazia = await reservarOrcamentoMl(3, agora);
    comandos = [];
    expect(await devolverOrcamentoMl(vazia, 0, agora)).toBe(0);
    expect(comandos).toHaveLength(0);
  });

  it('chave da reserva já expirada (3 min depois): devolução não gasta comando nem recria contador negativo', async () => {
    const r = await reservarOrcamentoMl(10, agora);
    comandos = [];
    expect(await devolverOrcamentoMl(r, 4, new Date(agora.getTime() + 3 * 60_000))).toBe(0);
    expect(comandos).toHaveLength(0);
    // limite exato: início do minuto (14:05:00) + 120 s = 14:07:00 já não devolve; 14:06:59 devolve
    const r2 = await reservarOrcamentoMl(5, agora);
    expect(await devolverOrcamentoMl(r2, 1, new Date('2026-11-03T14:07:00.000Z'))).toBe(0);
    const r3 = await reservarOrcamentoMl(5, agora);
    expect(await devolverOrcamentoMl(r3, 1, new Date('2026-11-03T14:06:59.999Z'))).toBe(1);
  });

  it('reserva que não veio de reservarOrcamentoMl: no-op', async () => {
    expect(await devolverOrcamentoMl({ concedidas: 10, chave: 'ext:mlapp:202611031405' }, 4, agora)).toBe(0);
    expect(comandos).toHaveLength(0);
  });

  it('erro ao devolver mantém o débito sem lançar', async () => {
    const r = await reservarOrcamentoMl(10, agora);
    respostaForcada = { status: 500 };
    expect(await devolverOrcamentoMl(r, 4, agora)).toBe(0);
  });
});
