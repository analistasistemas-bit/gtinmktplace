// Cotas da fatia 2 por LOTE (Revisão 03/11, regras 2, 3, 8, 9): Redis falso em memória atrás do fetch
// do cliente REST real, para contar comandos de verdade (Upstash cobra por comando).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chaveEnriquecimento, chaveOrcamentoMl, devolverOrcamentoMl, LIMITE_ENRIQUECIMENTO_MIN, LIMITE_ORCAMENTO_ML_MIN,
  reservarEnriquecimento, reservarOrcamentoMl,
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
const PROXIMO = '2026-11-03T14:06:00.000Z';
const ops = () => comandos.map((c) => c[0]);

beforeEach(() => {
  db.clear(); ttl.clear(); comandos = []; respostaForcada = null;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'UPSTASH_REDIS_REST_URL' ? 'https://r.test' : 'tok') } });
});

describe('chaves', () => {
  it('janela de minuto UTC; global sem tenant', () => {
    expect(chaveEnriquecimento('org1', 'u1', agora)).toBe('ext:enr:org1:u1:202611031405');
    expect(chaveOrcamentoMl(agora)).toBe('ext:mlapp:202611031405');
    expect(LIMITE_ENRIQUECIMENTO_MIN).toBe(10);
    expect(LIMITE_ORCAMENTO_ML_MIN).toBe(120);
  });
});

describe('reservarEnriquecimento', () => {
  it('25 catálogos em lotes de 5: concede 10 e depois retomarEm no próximo minuto', async () => {
    const r: { permitidos: number; retomarEm: string | null }[] = [];
    for (let i = 0; i < 5; i++) r.push(await reservarEnriquecimento('org1', 'u1', 5, agora));
    expect(r.map((x) => x.permitidos)).toEqual([5, 5, 0, 0, 0]);
    expect(r[0].retomarEm).toBeNull();
    expect(r[1].retomarEm).toBeNull();
    expect(r[2].retomarEm).toBe(PROXIMO);
    // excedente devolvido: a janela não infla além do teto
    expect(db.get('ext:enr:org1:u1:202611031405')).toBe(10);
  });

  it('EXPIRE 120 s só quando a chave nasce', async () => {
    await reservarEnriquecimento('org1', 'u1', 3, agora);
    await reservarEnriquecimento('org1', 'u1', 3, agora);
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY']);
    expect(ttl.get('ext:enr:org1:u1:202611031405')).toBe(120);
  });

  it('lote parcial: devolve exatamente o excedente e concede o restante', async () => {
    db.set('ext:enr:org1:u1:202611031405', 8);
    const r = await reservarEnriquecimento('org1', 'u1', 5, agora);
    expect(r).toEqual({ permitidos: 2, retomarEm: PROXIMO });
    expect(comandos).toEqual([['INCRBY', 'ext:enr:org1:u1:202611031405', 5], ['DECRBY', 'ext:enr:org1:u1:202611031405', 3]]);
    expect(db.get('ext:enr:org1:u1:202611031405')).toBe(10);
  });

  it('nunca devolve mais do que a própria requisição somou (concorrência estourou antes)', async () => {
    db.set('ext:enr:org1:u1:202611031405', 14);
    const r = await reservarEnriquecimento('org1', 'u1', 5, agora);
    expect(r.permitidos).toBe(0);
    expect(comandos[1]).toEqual(['DECRBY', 'ext:enr:org1:u1:202611031405', 5]);
    expect(db.get('ext:enr:org1:u1:202611031405')).toBe(14);
  });

  it('usuários e orgs independentes', async () => {
    await reservarEnriquecimento('org1', 'u1', 10, agora);
    expect((await reservarEnriquecimento('org1', 'u2', 5, agora)).permitidos).toBe(5);
    expect((await reservarEnriquecimento('org2', 'u1', 5, agora)).permitidos).toBe(5);
    expect((await reservarEnriquecimento('org1', 'u1', 1, agora)).permitidos).toBe(0);
  });

  it('quantidade 0 não gasta comando', async () => {
    expect(await reservarEnriquecimento('org1', 'u1', 0, agora)).toEqual({ permitidos: 0, retomarEm: null });
    expect(comandos).toHaveLength(0);
  });

  it.each([{ result: null }, { result: 'lixo' }, { status: 500 }])('Redis inválido/indisponível → fail-closed %j', async (resp) => {
    respostaForcada = resp;
    expect(await reservarEnriquecimento('org1', 'u1', 5, agora)).toEqual({ permitidos: 0, retomarEm: PROXIMO });
  });

  it('contagem de comandos: ≤ 2 por lote, +1 DECRBY só quando passa do teto', async () => {
    await reservarEnriquecimento('org1', 'u1', 5, agora); // INCRBY + EXPIRE
    expect(comandos).toHaveLength(2);
    await reservarEnriquecimento('org1', 'u1', 5, agora); // INCRBY
    expect(comandos).toHaveLength(3);
    await reservarEnriquecimento('org1', 'u1', 5, agora); // INCRBY + DECRBY
    expect(comandos).toHaveLength(5);
  });
});

describe('orçamento global do ML', () => {
  it('teto 120 compartilhado entre tenants; excedente devolvido', async () => {
    const a = await reservarOrcamentoMl(100, agora);
    const b = await reservarOrcamentoMl(30, agora);
    expect(a).toEqual({ concedidas: 100, chave: 'ext:mlapp:202611031405', retomarEm: null });
    expect(b).toEqual({ concedidas: 20, chave: 'ext:mlapp:202611031405', retomarEm: PROXIMO });
    expect(db.get('ext:mlapp:202611031405')).toBe(120);
    expect(ops()).toEqual(['INCRBY', 'EXPIRE', 'INCRBY', 'DECRBY']);
  });

  it.each([{ result: null }, { result: 'lixo' }, { status: 503 }])('Redis inválido → 0 concedidas (fail-closed) %j', async (resp) => {
    respostaForcada = resp;
    expect(await reservarOrcamentoMl(10, agora)).toEqual({ concedidas: 0, chave: 'ext:mlapp:202611031405', retomarEm: PROXIMO });
  });

  it('devolver: só as não despachadas, na chave original, uma vez', async () => {
    const r = await reservarOrcamentoMl(10, agora);
    comandos = [];
    // devolver não recebe relógio: mesmo que o minuto vire, vai à chave gravada na reserva
    expect(await devolverOrcamentoMl(r, 4)).toBe(4);
    expect(comandos).toEqual([['DECRBY', 'ext:mlapp:202611031405', 4]]);
    expect(await devolverOrcamentoMl(r, 4)).toBe(0);
    expect(comandos).toHaveLength(1);
    expect(db.get('ext:mlapp:202611031405')).toBe(6);
  });

  it('devolver nunca excede o que a reserva recebeu; nada a devolver = sem comando', async () => {
    db.set('ext:mlapp:202611031405', 115);
    const r = await reservarOrcamentoMl(10, agora); // concede 5
    comandos = [];
    expect(await devolverOrcamentoMl(r, 10)).toBe(5);
    expect(comandos).toEqual([['DECRBY', 'ext:mlapp:202611031405', 5]]);
    const vazia = await reservarOrcamentoMl(3, agora);
    comandos = [];
    expect(await devolverOrcamentoMl(vazia, 0)).toBe(0);
    expect(comandos).toHaveLength(0);
  });

  it('erro ao devolver mantém o débito sem lançar', async () => {
    const r = await reservarOrcamentoMl(10, agora);
    respostaForcada = { status: 500 };
    expect(await devolverOrcamentoMl(r, 4)).toBe(0);
  });
});
