import { describe, it, expect, vi } from 'vitest';
import { executarArquivamento } from '../arquivar-org.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const base = (over = {}) => ({
  orgAlvo: ORG, orgDoChamador: null as string | null, arquivar: true,
  existe: vi.fn().mockResolvedValue(true),
  rpc: vi.fn().mockResolvedValue({ data: '2026-10-01T00:00:00Z', error: null }),
  auditar: vi.fn().mockResolvedValue(null),
  ...over,
});

describe('executarArquivamento', () => {
  it('400 sem org_id', async () => {
    const d = base({ orgAlvo: '' });
    expect((await executarArquivamento(d)).status).toBe(400);
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('400 org_id que não é UUID, sem auditar', async () => {
    const d = base({ orgAlvo: 'nao-uuid' });
    expect((await executarArquivamento(d)).status).toBe(400);
    expect(d.auditar).not.toHaveBeenCalled();
  });
  it('400 própria org', async () => {
    const d = base({ orgDoChamador: ORG });
    expect((await executarArquivamento(d)).status).toBe(400);
  });
  it('404 inexistente ANTES de auditar (FK de platform_audit_events)', async () => {
    const d = base({ existe: vi.fn().mockResolvedValue(false) });
    expect((await executarArquivamento(d)).status).toBe(404);
    expect(d.auditar).not.toHaveBeenCalled();
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('500 (não 404) quando a leitura da org falha', async () => {
    const d = base({ existe: vi.fn().mockRejectedValue(new Error('db down')) });
    expect((await executarArquivamento(d)).status).toBe(500);
    expect(d.auditar).not.toHaveBeenCalled();
  });
  it('arquiva: intent → rpc → success', async () => {
    const d = base();
    const r = await executarArquivamento(d);
    expect(r).toEqual({ status: 200, body: { ok: true, arquivada_em: '2026-10-01T00:00:00Z' } });
    expect(d.rpc).toHaveBeenCalledWith('arquivar_organizacao', { p_org_id: ORG });
    expect(d.auditar.mock.calls.map((c) => c[1])).toEqual(['intent', 'success']);
  });
  it('500 se a auditoria failure não grava', async () => {
    const d = base({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '55000', message: 'membros' } }),
      auditar: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('boom'),
    });
    expect((await executarArquivamento(d)).status).toBe(500);
  });
  it('409 membros ativos (55000) com auditoria failure', async () => {
    const d = base({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '55000', message: 'A organização ainda possui membros ativos.' } }) });
    const r = await executarArquivamento(d);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'A organização ainda possui membros ativos.' });
    expect(d.auditar.mock.calls.map((c) => c[1])).toEqual(['intent', 'failure']);
  });
  it('404 inexistente (P0002)', async () => {
    const d = base({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'P0002', message: 'Organização não encontrada.' } }) });
    expect((await executarArquivamento(d)).status).toBe(404);
  });
  it('500 se auditoria intent falha, sem chamar rpc', async () => {
    const d = base({ auditar: vi.fn().mockResolvedValue('boom') });
    expect((await executarArquivamento(d)).status).toBe(500);
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('desarquiva', async () => {
    const d = base({ arquivar: false, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const r = await executarArquivamento(d);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(d.rpc).toHaveBeenCalledWith('desarquivar_organizacao', { p_org_id: ORG });
  });
});
