import { describe, expect, it } from 'vitest';
import { lerConexaoML, MSG_RECONECTAR, MSG_SEM_CONEXAO, respostaFalhaCriacao, SemConexaoML } from '../falhas.ts';
import { SemAcessoPromocoes } from '../../promocoes/ml.ts';
import { SemEscritaPromocoes } from '../ml.ts';

// Cadeia from().select().eq().eq().maybeSingle() devolvendo `resultado`.
const adminCom = (resultado: { data: unknown; error: unknown }) => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => resultado };
  return { from: () => q } as never;
};

describe('lerConexaoML', () => {
  it('erro de leitura lança (não vira "sem conexão")', async () => {
    await expect(lerConexaoML(adminCom({ data: null, error: { message: 'timeout' } }), 'o1'))
      .rejects.toThrow('marketplace_connections: timeout');
  });
  it('sem linha → null (ausência real)', async () => {
    expect(await lerConexaoML(adminCom({ data: null, error: null }), 'o1')).toBeNull();
  });
  it('linha → conexão', async () => {
    const row = { id: 'c1', org_id: 'o1', canal: 'mercado_livre', conta_externa_id: '42', expires_at: null };
    expect(await lerConexaoML(adminCom({ data: row, error: null }), 'o1'))
      .toEqual({ id: 'c1', orgId: 'o1', canal: 'mercado_livre', contaExternaId: '42', expiresAt: null });
  });
});

describe('respostaFalhaCriacao', () => {
  it('sem conexão → 400; ML recusou o token → 403', () => {
    expect(respostaFalhaCriacao(new SemConexaoML())).toEqual({ status: 400, erro: MSG_SEM_CONEXAO });
    expect(respostaFalhaCriacao(new SemAcessoPromocoes('ML 401 em /items'))).toEqual({ status: 403, erro: MSG_RECONECTAR });
    expect(respostaFalhaCriacao(new SemEscritaPromocoes('ML 403'))).toEqual({ status: 403, erro: MSG_RECONECTAR });
  });
  it('outra falha (rede, refresh, banco) → null = 500 transitório', () => {
    expect(respostaFalhaCriacao(new Error('refresh falhou'))).toBeNull();
  });
});
