import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mlGet } from '../../ml/http.ts';
import { adicionarAoRadar } from '../adicionar.ts';

vi.mock('../../ml/http.ts', () => ({ mlGet: vi.fn() }));

const ops: { tabela: string; op: string; valor?: unknown }[] = [];
let existente: { id: string; status: string } | null = null;
let gtinVariacao: string | null = null;
const admin = {
  from: (tabela: string) => {
    let op = 'select';
    let valor: unknown;
    const q = {
      select: () => q, eq: () => q, not: () => q, limit: () => q,
      update: (v: unknown) => { op = 'update'; valor = v; return q; },
      upsert: (v: unknown) => { op = 'upsert'; valor = v; return q; },
      maybeSingle: () => Promise.resolve({ data: tabela === 'variacoes' ? (gtinVariacao ? { gtin: gtinVariacao } : null) : existente, error: null }),
      single: () => { ops.push({ tabela, op, valor }); return Promise.resolve({ data: { id: 'novo' }, error: null }); },
      then: (ok: (r: unknown) => unknown) => { ops.push({ tabela, op, valor }); return Promise.resolve({ error: null }).then(ok); },
    };
    return q;
  },
} as never;

beforeEach(() => { ops.length = 0; existente = null; gtinVariacao = null; vi.mocked(mlGet).mockResolvedValue({ name: 'Fone JBL' }); });

describe('adicionarAoRadar (núcleo do pulse-adicionar)', () => {
  it('ficha inexistente no ML: não grava nada', async () => {
    vi.mocked(mlGet).mockResolvedValue(null);
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: false, motivo: 'ficha_inexistente' });
    expect(ops).toEqual([]);
  });

  it('já no radar: reaproveita a linha sem upsert (não rebaixa origem nem força status)', async () => {
    existente = { id: 'p1', status: 'pausado' };
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: true, produtoId: 'p1', jaExistia: true });
    expect(ops).toEqual([]);
  });

  it('arquivado: só reativa o status', async () => {
    existente = { id: 'p1', status: 'arquivado' };
    await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null);
    expect(ops).toEqual([{ tabela: 'pulse_produtos', op: 'update', valor: { status: 'ativo' } }]);
  });

  it('novo: upsert manual/ativo com título da ficha e GTIN da nossa variação quando não informado', async () => {
    gtinVariacao = '7891234567895';
    expect(await adicionarAoRadar(admin, 'org', 'MLB1', 'tok', null)).toEqual({ ok: true, produtoId: 'novo', jaExistia: false });
    expect(ops).toEqual([{ tabela: 'pulse_produtos', op: 'upsert', valor: { org_id: 'org', catalog_product_id: 'MLB1', titulo: 'Fone JBL', gtin: '7891234567895', origem: 'manual', status: 'ativo' } }]);
  });
});
