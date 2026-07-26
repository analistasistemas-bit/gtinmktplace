import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A confirmação da conexão (ADR-0091) é o passo que grava o vínculo na org da sessão. O que se
// testa aqui é o contrato com o usuário: as mensagens vindas da edge function precisam chegar
// intactas à tela, porque "a confirmação expirou, recomece" e "esta conta já está conectada em
// outra organização" pedem ações opostas — repetir o fluxo versus desconectar da outra org.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-de-teste' } } }) },
  },
}));

import { confirmarConexaoML } from '@/lib/ml-oauth';

const respostaFake = (status: number, corpo: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corpo,
}) as Response;

describe('confirmarConexaoML', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('manda o claim_id no corpo, como JSON e com o JWT da sessão', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaFake(200, { ok: true, conta: 'loja-teste' }));

    await confirmarConexaoML('claim-123');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('/functions/v1/ml-oauth-claim');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ claim_id: 'claim-123' });
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer jwt-de-teste');
  });

  it('devolve o nickname da conta no sucesso', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaFake(200, { ok: true, conta: 'loja-teste' }));
    await expect(confirmarConexaoML('c1')).resolves.toEqual({ conta: 'loja-teste' });
  });

  it('propaga a mensagem de "expirado" (410) em vez de um erro genérico', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaFake(410, {
      erro: 'expirado', mensagem: 'A confirmação expirou. Clique em Conectar para recomeçar.',
    }));
    await expect(confirmarConexaoML('c1')).rejects.toThrow(/expirou.*Conectar para recome/i);
  });

  it('propaga a mensagem de conta em outra organização (409)', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaFake(409, {
      erro: 'conta_em_outra_org',
      mensagem: 'Esta conta do Mercado Livre já está conectada em outra organização.',
    }));
    await expect(confirmarConexaoML('c1')).rejects.toThrow(/outra organiza/i);
  });

  it('cai numa mensagem própria quando a edge não manda nenhuma', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaFake(500, {}));
    await expect(confirmarConexaoML('c1')).rejects.toThrow(/500/);
  });
});
