import { afterEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));

import {
  cancelSupport,
  decideSupport,
  fetchSupportContext,
  listSupportRequests,
  requestSupport,
  revokeSupport,
} from '../suporte';

afterEach(() => vi.clearAllMocks());

describe('cliente de suporte', () => {
  it('trata 403 de contexto como ausência de sessão de suporte', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { status: 403 } });

    await expect(fetchSupportContext()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('suporte', { body: { action: 'context' } });
  });

  it('envia as ações de solicitação e decisão com o contrato da Edge Function', async () => {
    invoke
      .mockResolvedValueOnce({ data: { request: { id: 'r1' } }, error: null })
      .mockResolvedValueOnce({ data: { request: { id: 'r1', status: 'approved' } }, error: null })
      .mockResolvedValueOnce({ data: { request: { id: 'r1', status: 'cancelled' } }, error: null })
      .mockResolvedValueOnce({ data: { request: { id: 'r1', status: 'revoked' } }, error: null });

    await requestSupport({ orgId: 'org-1', scope: 'read', reason: 'Investigar erro' });
    await decideSupport('r1', 'approved');
    await cancelSupport('r1');
    await revokeSupport('r1');

    expect(invoke.mock.calls.map((call) => call[1].body)).toEqual([
      { action: 'request', org_id: 'org-1', scope: 'read', reason: 'Investigar erro' },
      { action: 'decide', request_id: 'r1', decision: 'approved' },
      { action: 'cancel', request_id: 'r1' },
      { action: 'revoke', request_id: 'r1' },
    ]);
  });

  it('extrai a mensagem real retornada pela Edge Function', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error: 'já existe pedido pendente' }), { status: 409 }) },
    });

    await expect(listSupportRequests()).rejects.toThrow('já existe pedido pendente');
  });

  it('envia paginação limitada ao listar solicitações', async () => {
    invoke.mockResolvedValueOnce({ data: { requests: [], total: 0, page: 2, pageSize: 20 }, error: null });
    await listSupportRequests({ page: 2, pageSize: 20, status: 'history' });
    expect(invoke).toHaveBeenCalledWith('suporte', { body: { action: 'list', page: 2, page_size: 20, status: 'history' } });
  });
});
