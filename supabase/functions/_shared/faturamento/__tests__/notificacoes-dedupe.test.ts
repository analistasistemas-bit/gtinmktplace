import { describe, it, expect, vi, afterEach } from 'vitest';
import { reservarNotificacao } from '../notificacoes-dedupe';

type Resultado = { data: unknown[] | null; error: { code: string; message: string } | null };

/** Fake do encadeamento `from().upsert(linha, opcoes).select(colunas)`, guardando o que foi pedido. */
function fakeAdmin(result: Resultado) {
  const chamadas: { tabela?: string; linha?: unknown; opcoes?: unknown; colunas?: string } = {};
  const admin = {
    from: (tabela: string) => {
      chamadas.tabela = tabela;
      return {
        upsert: (linha: unknown, opcoes: unknown) => {
          chamadas.linha = linha;
          chamadas.opcoes = opcoes;
          return { select: async (colunas: string) => { chamadas.colunas = colunas; return result; } };
        },
      };
    },
  } as any;
  return { admin, chamadas };
}

afterEach(() => vi.restoreAllMocks());

describe('reservarNotificacao', () => {
  it('retorna true quando esta chamada inseriu a linha (ganhou a corrida)', async () => {
    const { admin, chamadas } = fakeAdmin({ data: [{ chave: '123' }], error: null });
    expect(await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123')).toBe(true);
    expect(chamadas.tabela).toBe('ml_notificacoes_enviadas');
    expect(chamadas.linha).toEqual({ org_id: 'org-1', user_id: 'user-1', entidade: 'venda_paga', chave: '123' });
  });

  it('usa ON CONFLICT DO NOTHING na PK (sem erro 23505 no log do Postgres)', async () => {
    const { admin, chamadas } = fakeAdmin({ data: [{ chave: '123' }], error: null });
    await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123');
    expect(chamadas.opcoes).toEqual({ onConflict: 'org_id,entidade,chave', ignoreDuplicates: true });
    expect(chamadas.colunas).toBe('chave');
  });

  it('retorna false quando a chave já existia (conflito devolve lista vazia)', async () => {
    const { admin } = fakeAdmin({ data: [], error: null });
    expect(await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123')).toBe(false);
  });

  it('retorna false se o PostgREST devolver data null', async () => {
    const { admin } = fakeAdmin({ data: null, error: null });
    expect(await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123')).toBe(false);
  });

  it('retorna false (fail-closed) em erro genuíno, sem lançar, e loga', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin } = fakeAdmin({ data: null, error: { code: '08006', message: 'connection failure' } });
    await expect(reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123')).resolves.toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('23505 (defensivo) → false sem logar', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin } = fakeAdmin({ data: null, error: { code: '23505', message: 'duplicate key' } });
    expect(await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123')).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('entidades diferentes usam a chave passada por parâmetro; user_id nulo é aceito', async () => {
    const { admin, chamadas } = fakeAdmin({ data: [{ chave: '456' }], error: null });
    expect(await reservarNotificacao(admin, 'org-1', null, 'pergunta_nova', '456')).toBe(true);
    expect(chamadas.linha).toEqual({ org_id: 'org-1', user_id: null, entidade: 'pergunta_nova', chave: '456' });
  });
});
