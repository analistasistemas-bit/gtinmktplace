import { describe, expect, it } from 'vitest';
import { chaveMetricasAds, lerMetricasComCache, type DepsCacheAds } from '../metricas-cache.ts';

const base = {
  orgId: 'org-1', conexaoId: 'con-1', advertiserId: 10, escopo: 'conta' as const, campanhaId: null,
  atual: { desde: '2026-09-30', ate: '2026-10-29' }, anterior: { desde: '2026-08-31', ate: '2026-09-29' },
};

describe('chaveMetricasAds', () => {
  it('difere por org, conexão, anunciante, datas, campanha, escopo e comparação', () => {
    const k = chaveMetricasAds(base);
    const variantes = [
      { ...base, orgId: 'org-2' }, { ...base, conexaoId: 'con-2' }, { ...base, advertiserId: 11 },
      { ...base, atual: { desde: '2026-09-29', ate: '2026-10-29' } },
      { ...base, atual: { desde: '2026-09-30', ate: '2026-10-28' } },
      { ...base, escopo: 'campanha' as const, campanhaId: 5 },
      { ...base, escopo: 'campanha' as const, campanhaId: 6 },
      { ...base, anterior: null },
      { ...base, anterior: { desde: '2026-08-30', ate: '2026-09-29' } },
    ];
    const todas = new Set([k, ...variantes.map(chaveMetricasAds)]);
    expect(todas.size).toBe(variantes.length + 1);
    expect(chaveMetricasAds({ ...base })).toBe(k);
  });
  it('os 4 escopos geram chaves distintas', () => {
    const escopos = ['conta', 'campanhas', 'campanha', 'competitividade'] as const;
    expect(new Set(escopos.map((escopo) => chaveMetricasAds({ ...base, escopo }))).size).toBe(4);
  });
  it('separadores nos valores não colidem chaves', () => {
    expect(chaveMetricasAds({ ...base, orgId: 'a:b', conexaoId: 'c' }))
      .not.toBe(chaveMetricasAds({ ...base, orgId: 'a', conexaoId: 'b:c' }));
  });
});

function redis(opts: { getFalha?: boolean; setNXFalha?: boolean; setFalha?: boolean } = {}) {
  const mem = new Map<string, string>();
  const nx = new Map<string, number>(); // chave -> expira em (ms)
  const ttlsNX: number[] = [];
  const relogio = { ms: 0 };
  const sets: { chave: string; ttl: number }[] = [];
  const deps: DepsCacheAds = {
    get: async (c) => { if (opts.getFalha) throw new Error('x'); return mem.get(c) ?? null; },
    set: async (c, v, ttl) => { if (opts.setFalha) throw new Error('x'); sets.push({ chave: c, ttl }); mem.set(c, v); },
    setNX: async (c, _v, ttl) => {
      if (opts.setNXFalha) throw new Error('x');
      if ((nx.get(c) ?? 0) > relogio.ms) return false;
      nx.set(c, relogio.ms + ttl * 1000); ttlsNX.push(ttl); return true;
    },
  };
  return { deps, mem, sets, ttlsNX, relogio };
}
const ler = (n: { v: number }, completo = true) => async () => { n.v++; return { valor: { total: n.v }, completo }; };

describe('lerMetricasComCache', () => {
  it('segunda leitura vem do cache; gravação é substituição (TTL 300), sem acumular', async () => {
    const r = redis(); const n = { v: 0 };
    const a = await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler(n));
    const b = await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler(n));
    expect(n.v).toBe(1);
    expect(a).toEqual({ estado: 'ok', valor: { total: 1 }, origem: 'ml' });
    expect(b).toEqual({ estado: 'ok', valor: { total: 1 }, origem: 'cache' });
    expect(r.sets).toEqual([{ chave: 'k', ttl: 300 }]);
  });
  it('resposta incompleta não é gravada', async () => {
    const r = redis();
    const a = await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler({ v: 0 }, false));
    expect(a.estado).toBe('ok');
    expect(r.mem.size).toBe(0);
  });
  it('falha de leitura do cache segue para o ML', async () => {
    const r = redis({ getFalha: true });
    expect(await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler({ v: 0 }))).toMatchObject({ estado: 'ok', origem: 'ml' });
  });
  it('falha de gravação não derruba a resposta', async () => {
    const r = redis({ setFalha: true });
    expect(await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler({ v: 0 }))).toMatchObject({ estado: 'ok' });
  });
  it('fresco ignora o cache, substitui o valor, limita a 60 s e libera depois', async () => {
    const r = redis(); const n = { v: 0 };
    await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler(n));
    const f1 = await lerMetricasComCache(r.deps, 'k', 'org-1', true, ler(n));
    expect(f1).toEqual({ estado: 'ok', valor: { total: 2 }, origem: 'ml' });
    expect(r.ttlsNX).toEqual([60]);
    // o cache foi substituído (não acumulado): leitura normal devolve o valor do refresh
    expect(await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler(n))).toEqual({ estado: 'ok', valor: { total: 2 }, origem: 'cache' });
    r.relogio.ms = 59_000;
    expect(await lerMetricasComCache(r.deps, 'k', 'org-1', true, ler(n))).toMatchObject({ estado: 'recusado' });
    expect(n.v).toBe(2);
    expect(await lerMetricasComCache(r.deps, 'k2', 'org-2', true, ler(n))).toMatchObject({ estado: 'ok' });
    r.relogio.ms = 60_000;
    expect(await lerMetricasComCache(r.deps, 'k', 'org-1', true, ler(n))).toEqual({ estado: 'ok', valor: { total: 4 }, origem: 'ml' });
    expect(await lerMetricasComCache(r.deps, 'k', 'org-1', false, ler(n))).toEqual({ estado: 'ok', valor: { total: 4 }, origem: 'cache' });
  });
  it('Redis indisponível no throttle: refresh recusado com mensagem recuperável, sem chamar o ML', async () => {
    const r = redis({ setNXFalha: true }); const n = { v: 0 };
    const a = await lerMetricasComCache(r.deps, 'k', 'org-1', true, ler(n));
    expect(a).toMatchObject({ estado: 'recusado' });
    expect((a as { motivo: string }).motivo).toMatch(/tente novamente/i);
    expect(n.v).toBe(0);
  });
});
