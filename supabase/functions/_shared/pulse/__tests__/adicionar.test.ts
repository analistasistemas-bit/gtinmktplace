import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adicionarAoRadar, MENSAGEM_ML_INDISPONIVEL } from '../adicionar.ts';

const ops: { tabela: string; op: string; valor?: unknown; eqs: string[] }[] = [];
let existente: { id: string; status: string } | null = null;
let gtinVariacao: string | null = null;
let erroLeitura: string | null = null;
let erroUpdate: string | null = null;
const admin = {
  from: (tabela: string) => {
    let op = 'select';
    let valor: unknown;
    const eqs: string[] = [];
    const q = {
      select: () => q, not: () => q, limit: () => q,
      eq: (c: string) => { eqs.push(c); return q; },
      update: (v: unknown) => { op = 'update'; valor = v; return q; },
      upsert: (v: unknown) => { op = 'upsert'; valor = v; return q; },
      maybeSingle: () => Promise.resolve(tabela === 'variacoes'
        ? { data: gtinVariacao ? { gtin: gtinVariacao } : null, error: null }
        : { data: erroLeitura ? null : existente, error: erroLeitura ? { message: erroLeitura } : null }),
      single: () => { ops.push({ tabela, op, valor, eqs }); return Promise.resolve({ data: { id: 'novo' }, error: null }); },
      then: (ok: (r: unknown) => unknown) => { ops.push({ tabela, op, valor, eqs }); return Promise.resolve({ error: erroUpdate ? { message: erroUpdate } : null }).then(ok); },
    };
    return q;
  },
} as never;
const ficha = (status: number, corpo: unknown = { name: 'Fone JBL' }) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));

beforeEach(() => {
  ops.length = 0; existente = null; gtinVariacao = null; erroLeitura = null; erroUpdate = null;
  vi.stubGlobal('fetch', ficha(200));
});

describe('adicionarAoRadar (núcleo do pulse-adicionar)', () => {
  it('ficha 404 no ML: inexistente, não grava nada', async () => {
    vi.stubGlobal('fetch', ficha(404, {}));
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: false, motivo: 'ficha_inexistente' });
    expect(ops).toEqual([]);
  });

  it('Grok: 5xx do ML é falha transitória (tenta 2×), não "ficha inexistente"', async () => {
    const f = ficha(503, {});
    vi.stubGlobal('fetch', f);
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: false, motivo: 'erro', mensagem: MENSAGEM_ML_INDISPONIVEL });
    expect(f).toHaveBeenCalledTimes(2);
    expect(ops).toEqual([]);
  });

  it('já no radar: reaproveita a linha sem upsert (não rebaixa origem nem força status)', async () => {
    existente = { id: 'p1', status: 'pausado' };
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: true, produtoId: 'p1', jaExistia: true });
    expect(ops).toEqual([]);
  });

  it('arquivado: só reativa o status, filtrando a org; erro no update não vira sucesso', async () => {
    existente = { id: 'p1', status: 'arquivado' };
    await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null);
    expect(ops).toEqual([{ tabela: 'pulse_produtos', op: 'update', valor: { status: 'ativo' }, eqs: ['id', 'org_id'] }]);
    erroUpdate = 'falhou';
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: false, motivo: 'erro', mensagem: 'falhou' });
  });

  it('Grok: leitura do existente falhou → erro, sem upsert destrutivo', async () => {
    erroLeitura = 'timeout';
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: false, motivo: 'erro', mensagem: 'timeout' });
    expect(ops).toEqual([]);
  });

  it('novo: upsert manual/ativo com título da ficha e GTIN da nossa variação quando não informado', async () => {
    gtinVariacao = '7891234567895';
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: true, produtoId: 'novo', jaExistia: false });
    expect(ops).toMatchObject([{ tabela: 'pulse_produtos', op: 'upsert', valor: { org_id: 'org', catalog_product_id: 'MLB1', titulo: 'Fone JBL', gtin: '7891234567895', origem: 'manual', status: 'ativo' } }]);
  });
});
