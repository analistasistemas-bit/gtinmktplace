import { describe, it, expect } from 'vitest';
import { reservarNotificacao } from '../notificacoes-dedupe';

function fakeAdmin(result: { error: { code: string; message: string } | null }) {
  return {
    from: () => ({
      insert: async () => result,
    }),
  } as any;
}

describe('reservarNotificacao', () => {
  it('retorna true quando o INSERT é bem-sucedido (ganhou a corrida)', async () => {
    const admin = fakeAdmin({ error: null });
    const ganhou = await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123');
    expect(ganhou).toBe(true);
  });

  it('retorna false em 23505 (outro processo já reservou essa chave)', async () => {
    const admin = fakeAdmin({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const ganhou = await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123');
    expect(ganhou).toBe(false);
  });

  it('retorna false (fail-closed) em erro genuíno, sem lançar', async () => {
    const admin = fakeAdmin({ error: { code: '08006', message: 'connection failure' } });
    await expect(reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123')).resolves.toBe(false);
  });

  it('entidades diferentes (pergunta_nova vs venda_paga) usam a chave passada por parâmetro', async () => {
    const admin = fakeAdmin({ error: null });
    const ganhou = await reservarNotificacao(admin, 'org-1', null, 'pergunta_nova', '456');
    expect(ganhou).toBe(true);
  });
});
