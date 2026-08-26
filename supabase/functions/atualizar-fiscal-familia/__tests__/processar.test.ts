import { describe, it, expect, vi } from 'vitest';
import { processarAtualizacaoFiscal, validarShapeEntrada, type DepsAtualizarFiscal, type EntradaFiscal } from '../processar';

// ── Fake admin: familias/empresa_fiscal (padrão igual ao de publish-familia-ml). ──
function fakeAdmin(over: {
  familia?: Record<string, unknown> | null; regime?: string;
  erros?: { familias?: string; empresa_fiscal?: string; update?: string };
} = {}) {
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const familia = over.familia === undefined ? { ...FAMILIA_BASE } : over.familia;
  const regime = over.regime ?? 'simples';
  const erros = over.erros ?? {};
  function chain(table: string) {
    const rec = { op: '', payload: {} as Record<string, unknown>, filters: {} as Record<string, unknown> };
    const ler = () => {
      if (table === 'familias') return familia;
      if (table === 'empresa_fiscal') return { regime_tributario: regime };
      return null;
    };
    const erroDeLeitura = () => {
      if (table === 'familias') return erros.familias ? { message: erros.familias } : null;
      if (table === 'empresa_fiscal') return erros.empresa_fiscal ? { message: erros.empresa_fiscal } : null;
      return null;
    };
    const api: Record<string, unknown> = {
      select: () => { rec.op = rec.op || 'select'; return api; },
      eq: (col: string, val: unknown) => { rec.filters[col] = val; return api; },
      update: (payload: Record<string, unknown>) => { rec.op = 'update'; rec.payload = payload; return api; },
      maybeSingle: async () => {
        reads.push({ table, filters: rec.filters });
        return { data: erroDeLeitura() ? null : ler(), error: erroDeLeitura() };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === 'update') {
          writes.push({ table, payload: rec.payload, filters: rec.filters });
          const err = erros.update ? { message: erros.update } : null;
          return Promise.resolve({ data: null, error: err }).then(resolve);
        }
        reads.push({ table, filters: rec.filters });
        return Promise.resolve({ data: ler(), error: erroDeLeitura() }).then(resolve);
      },
    };
    return api;
  }
  return { admin: { from: chain } as never, writes, reads };
}

const FAMILIA_BASE = {
  id: 'fam-1', org_id: 'org-1', nome_pai: 'AGULHA', unidade: 'UN', origem: 'nacional',
  ml_item_id: 'MLB123', status: 'publicado',
};

const FISCAL_OK: EntradaFiscal['fiscal'] = {
  ncm: '39269090', cest: null, origemNfe: 0, fci: null, exTipi: null, tributacaoIcms: '102',
};

function deps(admin: DepsAtualizarFiscal['admin'], enfileirarPush?: DepsAtualizarFiscal['enfileirarPush']): DepsAtualizarFiscal {
  return { admin, orgId: 'org-1', enfileirarPush: enfileirarPush ?? vi.fn(async () => 'msg-1') };
}

describe('processarAtualizacaoFiscal', () => {
  it('família de outra org (ou inexistente) → nao_encontrada, filtrando por org_id', async () => {
    const { admin, writes, reads } = fakeAdmin({ familia: null });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-x', fiscal: FISCAL_OK });
    expect(r.tipo).toBe('nao_encontrada');
    expect(writes.length).toBe(0);
    expect(reads[0]).toEqual({ table: 'familias', filters: { id: 'fam-x', org_id: 'org-1' } });
  });

  it('fiscal incompleto → invalido com lista de erros, nada gravado', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await processarAtualizacaoFiscal(deps(admin), {
      familiaId: 'fam-1', fiscal: { ...FISCAL_OK, ncm: '123' },
    });
    expect(r.tipo).toBe('invalido');
    if (r.tipo === 'invalido') expect(r.erros.length).toBeGreaterThan(0);
    expect(writes.length).toBe(0);
  });

  it('fiscal completo + família publicada (Legacy, com ml_item_id) → grava com regime da org e enfileira o push', async () => {
    const { admin, writes } = fakeAdmin({ regime: 'simples' });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(writes.length).toBe(1);
    expect(writes[0].payload.tributacao_icms_regime).toBe('simples');
    expect(writes[0].payload.ncm).toBe('39269090');
    expect(enfileirarPush).toHaveBeenCalledWith('fam-1');
  });

  // Discrimina o gate de `status === 'publicado'` (pós-T7) do gate de `ml_item_id` do brief:
  // publicação via UP marca `status='publicado'` sem necessariamente preencher `ml_item_id` na
  // família (publicar-familia-up.ts). Sob `if (familia.ml_item_id)` este caso NÃO enfileiraria.
  it('publicada via UP (status publicado, sem ml_item_id) → enfileira mesmo assim', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, ml_item_id: null, status: 'publicado' } });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: true });
    expect(enfileirarPush).toHaveBeenCalledWith('fam-1');
  });

  it('família não publicada → grava mas não enfileira', async () => {
    const { admin, writes } = fakeAdmin({ familia: { ...FAMILIA_BASE, status: 'pronto', ml_item_id: null } });
    const enfileirarPush = vi.fn(async () => 'msg-1');
    const r = await processarAtualizacaoFiscal(deps(admin, enfileirarPush), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'ok', pushEnfileirado: false });
    expect(writes.length).toBe(1);
    expect(enfileirarPush).not.toHaveBeenCalled();
  });

  it('erro lendo familias → falha, nunca 404 (leitura com erro não é decisão)', async () => {
    const { admin, writes } = fakeAdmin({ erros: { familias: 'timeout' } });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'falha', mensagem: 'timeout' });
    expect(writes.length).toBe(0);
  });

  it('erro lendo empresa_fiscal → falha, nunca default de regime "simples" em silêncio', async () => {
    const { admin, writes } = fakeAdmin({ erros: { empresa_fiscal: 'timeout' } });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'falha', mensagem: 'timeout' });
    expect(writes.length).toBe(0);
  });

  it('erro no update → falha (não "invalido" com mensagem crua de banco)', async () => {
    const { admin } = fakeAdmin({ erros: { update: 'constraint violation' } });
    const r = await processarAtualizacaoFiscal(deps(admin), { familiaId: 'fam-1', fiscal: FISCAL_OK });
    expect(r).toEqual({ tipo: 'falha', mensagem: 'constraint violation' });
  });
});

describe('validarShapeEntrada', () => {
  it('body sem fiscal → mensagem de campo obrigatório', () => {
    expect(validarShapeEntrada({ familiaId: 'fam-1' })).toBe('familiaId (string) e fiscal (objeto) são obrigatórios');
  });

  it('body sem familiaId → mensagem de campo obrigatório', () => {
    expect(validarShapeEntrada({ fiscal: FISCAL_OK })).toBe('familiaId (string) e fiscal (objeto) são obrigatórios');
  });

  it('body válido → null', () => {
    expect(validarShapeEntrada({ familiaId: 'fam-1', fiscal: FISCAL_OK })).toBeNull();
  });
});

