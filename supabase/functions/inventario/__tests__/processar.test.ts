import { describe, it, expect } from 'vitest';
import { processarInventario, type DepsInventario } from '../processar.ts';

const id = '11111111-1111-4111-8111-111111111111';
const base = { orgId: 'org1', userId: 'u1' };
const confirmar = { ...base, corpo: { acao: 'confirmar' as const, inventario_id: id, versao: 2 } };

function deps(over: Partial<DepsInventario> = {}) {
  const filas: unknown[] = [];
  const d = {
    filas,
    rpc: async () => ({ data: { produtos: [{ codigo_pai: 'P1', reativar: false }, { codigo_pai: 'P2', reativar: true }] }, error: null }),
    enfileirar: async (job: unknown) => { filas.push(job); return 'm'; },
    ...over,
  };
  return d as DepsInventario & { filas: unknown[] };
}

describe('processarInventario', () => {
  it('confirmar enfileira um job por codigo_pai com reativar do SQL', async () => {
    const d = deps();
    expect(await processarInventario(d, confirmar)).toMatchObject({ status: 200, body: { push: 'ok' } });
    expect(d.filas).toEqual([
      { org_id: 'org1', codigo_pai: 'P1', canal_origem: null, reativar: false },
      { org_id: 'org1', codigo_pai: 'P2', canal_origem: null, reativar: true },
    ]);
  });
  it('resposta 200 leva X-Org-Id e o expose', async () => {
    const r = await processarInventario(deps(), confirmar);
    expect(r.headers).toEqual({ 'X-Org-Id': 'org1', 'Access-Control-Expose-Headers': 'X-Org-Id' });
  });
  it('enqueue que lança vira push pendente, sem erro; retry reenfileira a mesma lista', async () => {
    let falha = true;
    const d = deps();
    d.enfileirar = async (job) => { if (falha) throw new Error('qstash'); d.filas.push(job); return 'm'; };
    expect(await processarInventario(d, confirmar)).toMatchObject({ status: 200, body: { push: 'pendente' } });
    falha = false;
    expect(await processarInventario(d, confirmar)).toMatchObject({ status: 200, body: { push: 'ok' } });
    expect(d.filas).toHaveLength(2);
  });
  it('salvar traduz versão obsoleta em 409 e devolve a versão nova no sucesso', async () => {
    const msg = 'A contagem mudou em outra aba; recarregue.';
    const c = { ...base, corpo: { acao: 'salvar' as const, inventario_id: id, versao: 1, itens: [] } };
    const r = await processarInventario(deps({ rpc: async () => ({ data: null, error: { message: msg, code: '40001' } }) }), c);
    expect(r).toEqual({ status: 409, body: { error: msg } });
    const ok = await processarInventario(deps({ rpc: async () => ({ data: 3, error: null }) }), c);
    expect(ok).toMatchObject({ status: 200, body: { versao: 3 } });
  });
  it('mapeia 23514/P0002/22023 e erro desconhecido', async () => {
    const c = { ...base, corpo: { acao: 'hoje' as const } };
    const st = async (code?: string) =>
      (await processarInventario(deps({ rpc: async () => ({ data: null, error: { message: 'm', code } }) }), c)).status;
    expect(await st('23514')).toBe(422);
    expect(await st('P0002')).toBe(404);
    expect(await st('22023')).toBe(400);
    expect(await st('XX000')).toBe(500);
  });
  it('foto sem dados devolve vazio', async () => {
    const r = await processarInventario(deps({ rpc: async () => ({ data: null, error: null }) }),
      { ...base, corpo: { acao: 'foto', data_base: '2025-12-31' } });
    expect(r).toMatchObject({ status: 200, body: { vazio: true } });
  });
});
