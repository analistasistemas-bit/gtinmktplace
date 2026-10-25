import { describe, expect, it } from 'vitest';
import { avaliarAcesso, interpretarComando, secretDaOrg, secretValido } from '../bot.ts';

const CHAVE = 'chave-mestra';

describe('secretDaOrg / secretValido', () => {
  it('secret de (org-a, bot 1) só vale para (org-a, bot 1)', async () => {
    const s = await secretDaOrg(CHAVE, 'org-a', 1);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(await secretValido(CHAVE, 'org-a', 1, s)).toBe(true);
    expect(await secretValido(CHAVE, 'org-b', 1, s)).toBe(false);
    expect(await secretValido(CHAVE, 'org-a', 2, s)).toBe(false);
    expect(await secretValido(CHAVE, 'org-a', 1, null)).toBe(false);
    expect(await secretValido('outra-chave', 'org-a', 1, s)).toBe(false);
  });
});

describe('interpretarComando', () => {
  it('normaliza caixa e @bot; texto livre → null', () => {
    expect(interpretarComando('/TOP@PubliAIBot')).toBe('top');
    expect(interpretarComando('/hoje')).toBe('hoje');
    expect(interpretarComando(' /ontem extra')).toBe('ontem');
    expect(interpretarComando('/mes')).toBe('mes');
    expect(interpretarComando('/ajuda')).toBe('ajuda');
    expect(interpretarComando('oi')).toBeNull();
    expect(interpretarComando('/start')).toBeNull();
    expect(interpretarComando(undefined)).toBeNull();
  });
});

describe('avaliarAcesso', () => {
  const privado = { id: 42, type: 'private' };
  it('grupo → grupo, mesmo com admin', () => {
    expect(avaliarAcesso({ id: -100, type: 'group' }, [{ is_admin: true, is_active: true }])).toBe('grupo');
    expect(avaliarAcesso({ id: -100, type: 'supergroup' }, [])).toBe('grupo');
  });
  it('sem profile, não-admin ou admin inativo → sem_acesso', () => {
    expect(avaliarAcesso(privado, [])).toBe('sem_acesso');
    expect(avaliarAcesso(privado, [{ is_admin: false, is_active: true }])).toBe('sem_acesso');
    expect(avaliarAcesso(privado, [{ is_admin: true, is_active: false }])).toBe('sem_acesso');
  });
  it('algum admin ativo no chat → ok', () => {
    expect(avaliarAcesso(privado, [{ is_admin: false, is_active: true }, { is_admin: true, is_active: true }])).toBe('ok');
  });
});
