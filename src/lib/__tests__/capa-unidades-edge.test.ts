import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } } }));
import { gerarCapaUnidadesEdge } from '../capa-unidades-edge';

const resposta = (status: number, corpo: unknown) => ({ status, json: async () => corpo }) as unknown as Response;

describe('gerarCapaUnidadesEdge', () => {
  beforeEach(() => invokeMock.mockReset());

  it('envia request_id, familia_base_id e n em snake_case e devolve a resposta', async () => {
    invokeMock.mockResolvedValue({ data: { path: 'ORG/kit-variacao-ia/r.png', aprovado: true }, error: null });
    const r = await gerarCapaUnidadesEdge({ requestId: 'r1', familiaBaseId: 'F1', n: 3 });
    expect(invokeMock).toHaveBeenCalledWith('gerar-capa-kit-unidades', { body: { request_id: 'r1', familia_base_id: 'F1', n: 3 } });
    expect(r).toMatchObject({ ok: true, path: 'ORG/kit-variacao-ia/r.png', aprovado: true });
  });

  it('429 teto_diario volta como falha com o motivo', async () => {
    invokeMock.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { context: resposta(429, { error: 'Limite', motivo: 'teto_diario' }) }) });
    expect(await gerarCapaUnidadesEdge({ requestId: 'r', familiaBaseId: 'F', n: 2 })).toEqual({ ok: false, motivo: 'teto_diario', mensagem: 'Limite' });
  });

  it('erro sem corpo vira motivo "rede"', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('offline') });
    expect(await gerarCapaUnidadesEdge({ requestId: 'r', familiaBaseId: 'F', n: 2 })).toMatchObject({ ok: false, motivo: 'rede', mensagem: 'offline' });
  });
});
