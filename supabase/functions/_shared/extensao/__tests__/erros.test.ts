import { describe, expect, it } from 'vitest';
import { ErroExtensao, MENSAGEM_LIMITE, normalizarErro } from '../erros.ts';

describe('normalizarErro', () => {
  it('401 de requireUserOrg → sessao_expirada', () => {
    expect(normalizarErro(new Response('Invalid token', { status: 401 }))).toEqual({ status: 401, corpo: { erro: 'sessao_expirada' } });
  });

  it('403 marcado como sessão de suporte → sessao_suporte_expirada', () => {
    const r = new Response('{}', { status: 403, headers: { 'x-motivo': 'sessao_suporte' } });
    expect(normalizarErro(r)).toEqual({ status: 403, corpo: { erro: 'sessao_suporte_expirada' } });
  });

  it('403 sem marca (perfil inativo) não vira sessão de suporte', () => {
    expect(normalizarErro(new Response('{}', { status: 403 }))).toEqual({ status: 403, corpo: { erro: 'interno' } });
  });

  it('módulo desligado → 403 modulo_desligado', () => {
    expect(normalizarErro(new ErroExtensao('modulo_desligado', 403))).toEqual({ status: 403, corpo: { erro: 'modulo_desligado' } });
  });

  it('limite → 429 com a mensagem do D-18', () => {
    expect(normalizarErro(new ErroExtensao('limite', 429))).toEqual({ status: 429, corpo: { erro: 'limite', mensagem: MENSAGEM_LIMITE } });
    expect(MENSAGEM_LIMITE).toBe('Muitas análises em sequência. Aguarde um minuto.');
  });

  it('qualquer outra coisa → 500 interno, sem vazar a mensagem', () => {
    const r = normalizarErro(new Error('token APP_USR-123 vazou'));
    expect(r).toEqual({ status: 500, corpo: { erro: 'interno' } });
    expect(JSON.stringify(r)).not.toContain('APP_USR');
  });

  it('403 de requireUserOrg sem x-motivo → sem_acesso só com protocolo 2; sem protocolo continua interno', () => {
    expect(normalizarErro(new Response('{}', { status: 403 }), 2)).toEqual({ status: 403, corpo: { erro: 'sem_acesso' } });
    expect(normalizarErro(new Response('{}', { status: 403 }))).toEqual({ status: 403, corpo: { erro: 'interno' } });
    // Marca de suporte e erros de domínio não mudam com o protocolo.
    const sup = new Response('{}', { status: 403, headers: { 'x-motivo': 'sessao_suporte' } });
    expect(normalizarErro(sup, 2)).toEqual({ status: 403, corpo: { erro: 'sessao_suporte_expirada' } });
    expect(normalizarErro(new ErroExtensao('interno', 403), 2)).toEqual({ status: 403, corpo: { erro: 'interno' } });
  });

  it('identidade_mudou → 409', () => {
    expect(normalizarErro(new ErroExtensao('identidade_mudou', 409), 2)).toEqual({ status: 409, corpo: { erro: 'identidade_mudou' } });
  });
});
