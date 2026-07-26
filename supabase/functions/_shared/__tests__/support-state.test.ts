import { describe, expect, it } from 'vitest';
import { autorizarRequestSuporte, podeExcluirLote, resolverRenovacao, validarAcaoSuporte, validarTransicaoSuporte } from '../support-state.ts';

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
});

describe('fluxos de suporte extraídos do handler', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');
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
