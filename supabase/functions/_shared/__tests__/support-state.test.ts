import { describe, expect, it } from 'vitest';
import { autorizarRequestSuporte, iniciarSessaoSuporte, mapearInicioSuporte, podeExcluirLote, resolverContextoSuporte, resolverRenovacao, validarAcaoSuporte, validarTransicaoSuporte } from '../support-state.ts';

describe('validarAcaoSuporte', () => {
  it('normaliza um pedido válido', () => {
    expect(validarAcaoSuporte({ action: 'request', org_id: 'org-1', scope: 'full', reason: '  investigar falha  ' }))
      .toEqual({ action: 'request', orgId: 'org-1', scope: 'full', reason: 'investigar falha' });
  });

  it('rejeita motivo vazio, escopo inválido e ação desconhecida', () => {
    expect(() => validarAcaoSuporte({ action: 'request', org_id: 'org-1', scope: 'owner', reason: 'x' })).toThrow('escopo');
    expect(() => validarAcaoSuporte({ action: 'request', org_id: 'org-1', scope: 'read', reason: '   ' })).toThrow('motivo');
    expect(() => validarAcaoSuporte({ action: 'erase' })).toThrow('ação');
  });

  it('aceita somente decisões permitidas', () => {
    expect(validarAcaoSuporte({ action: 'decide', request_id: 'request-1', decision: 'approved' }))
      .toEqual({ action: 'decide', requestId: 'request-1', decision: 'approved' });
    expect(() => validarAcaoSuporte({ action: 'decide', request_id: 'request-1', decision: 'active' })).toThrow('decisão');
  });

  it('normaliza paginação limitada de solicitações', () => {
    expect(validarAcaoSuporte({ action: 'list', page: 2, page_size: 50, status: 'pending' }))
      .toEqual({ action: 'list', page: 2, pageSize: 50, status: 'pending' });
    expect(validarAcaoSuporte({ action: 'list', status: 'actionable' }))
      .toEqual({ action: 'list', page: 1, pageSize: 50, status: 'actionable' });
    expect(() => validarAcaoSuporte({ action: 'list', page: 0 })).toThrow('página');
    expect(() => validarAcaoSuporte({ action: 'list', page_size: 51 })).toThrow('page_size');
  });
});

describe('fluxos de suporte extraídos do handler', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');
  it('trata super-admin sem sessão ativa como contexto vazio', () => {
    expect(resolverContextoSuporte(true, null)).toBeNull();
    expect(resolverContextoSuporte(false, null)).toBeNull();
  });
  it('bloqueia IDOR de decisão e renovação em outra organização', () => {
    expect(() => autorizarRequestSuporte('decide', { requester_id: 's', org_id: 'org-a' }, 'a', { isAdmin: true, orgId: 'org-b', isSuperAdmin: false })).toThrow('forbidden');
    expect(() => resolverRenovacao({ id: 'old', org_id: 'org-a', expires_at: '2026-07-25T12:10:00Z' }, 'org-b', now)).toThrow('mesma organização');
  });
  it('aceita renovação apenas nos 15 minutos finais da mesma organização', () => {
    expect(resolverRenovacao({ id: 'old', org_id: 'org-a', expires_at: '2026-07-25T12:10:00Z' }, 'org-a', now)).toBe('old');
    expect(() => resolverRenovacao({ id: 'old', org_id: 'org-a', expires_at: '2026-07-25T12:16:00Z' }, 'org-a', now)).toThrow('15 minutos');
  });
  it('preserva ownership de lote para membro e libera somente suporte full no tenant', () => {
    expect(podeExcluirLote('owner', 'member', false)).toBe(false);
    expect(podeExcluirLote('owner', 'member', true)).toBe(true);
  });
});

describe('validarTransicaoSuporte', () => {
  const agora = new Date('2026-07-25T12:00:00.000Z');
  const pending = { requester_id: 'support-1', status: 'pending', pending_expires_at: '2026-07-25T13:00:00.000Z' };

  it('rejeita autoaprovação e decisão expirada', () => {
    expect(() => validarTransicaoSuporte('decide', pending, 'support-1', true, agora)).toThrow('solicitante');
    expect(() => validarTransicaoSuporte('decide', { ...pending, pending_expires_at: '2026-07-25T11:59:59.000Z' }, 'admin-1', true, agora)).toThrow('expirado');
  });

  it('aceita início somente enquanto a aprovação é utilizável', () => {
    expect(validarTransicaoSuporte(
      'start', { requester_id: 'support-1', status: 'approved', approval_expires_at: '2026-07-25T12:01:00.000Z' }, 'support-1', false, agora,
    )).toBeUndefined();
    expect(() => validarTransicaoSuporte(
      'start', { requester_id: 'support-1', status: 'approved', approval_expires_at: '2026-07-25T12:00:00.000Z' }, 'support-1', false, agora,
    )).toThrow('expirada');
  });

  it('rejeita transição repetida e revogação por não-admin', () => {
    expect(() => validarTransicaoSuporte('end', { requester_id: 'support-1', status: 'ended' }, 'support-1', false, agora)).toThrow('transição');
    expect(() => validarTransicaoSuporte('revoke', { requester_id: 'support-1', status: 'active', expires_at: '2026-07-25T13:00:00.000Z' }, 'admin-1', false, agora)).toThrow('administrador');
  });
});

describe('mapearInicioSuporte', () => {
  it.each(['P0001', '23505'])('converte erro RPC %s em conflito de transição', (code) => {
    expect(mapearInicioSuporte({ code })).toEqual({
      status: 409,
      error: 'transição não disponível',
    });
  });

  it('converte erro operacional da RPC em 500 sem vazar detalhes', () => {
    const failure = mapearInicioSuporte({ code: 'XX000', message: 'segredo interno' });
    expect(failure).toEqual({
      status: 500,
      error: 'falha ao iniciar suporte',
    });
    expect(JSON.stringify(failure)).not.toContain('segredo interno');
  });

  it('converte resultado vazio da RPC em conflito de transição', () => {
    expect(mapearInicioSuporte(null, null)).toEqual({
      status: 409,
      error: 'transição não disponível',
    });
  });
});

describe('iniciarSessaoSuporte', () => {
  it('envia request, usuário e timestamp à RPC e preserva a resposta com aviso', async () => {
    const started = { id: 'request-1', org_id: 'org-1', status: 'active' };
    const result = await iniciarSessaoSuporte(
      async (name, args) => {
        expect(name).toBe('start_support_session');
        expect(args).toEqual({
          p_request_id: 'request-1',
          p_requester_id: 'user-1',
          p_now: '2026-07-25T12:00:00.000Z',
        });
        return { data: started, error: null };
      },
      'request-1',
      'user-1',
      new Date('2026-07-25T12:00:00.000Z'),
      async (request) => {
        expect(request).toBe(started);
        return 'falha parcial de notificação';
      },
    );

    expect(result).toEqual({
      status: 200,
      body: {
        request: started,
        notification_warning: 'falha parcial de notificação',
      },
    });
  });
});
