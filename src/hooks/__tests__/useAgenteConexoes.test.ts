import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CHAVE = 'pai_ab12cd34_' + 'y'.repeat(43);
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: m.invoke } } }));

const { criarConexaoAgente, alterarPermissoesAgente, useAgenteConexoes, useInvalidarConexoes, useRevogarConexao } = await import('../useAgenteConexoes');

describe('useAgenteConexoes: a chave não entra no cache', () => {
  it('depois de criar e invalidar a lista, nenhuma mutation em cache e nenhuma query contém a chave', async () => {
    m.invoke.mockImplementation(async (_nome: string, { body }: { body: { acao: string } }) => {
      if (body.acao === 'criar') return { data: { id: 'c1', chave: CHAVE, prefixo: 'ab12cd34', expira_em: 'e' }, error: null };
      return { data: [{ id: 'c1', nome: 'x', prefixo: 'ab12cd34', criada_em: 'c', expira_em: 'e', revogada_em: null, ultimo_uso_em: null }], error: null };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => ({
      lista: useAgenteConexoes(), invalidar: useInvalidarConexoes(), revogar: useRevogarConexao(),
    }), { wrapper });
    await waitFor(() => expect(result.current.lista.data).toBeDefined());

    let criada: { chave: string } | undefined;
    await act(async () => {
      criada = await criarConexaoAgente('x', 90, ['margens']);
      await result.current.invalidar();
    });
    expect(criada?.chave).toBe(CHAVE);
    expect(m.invoke).toHaveBeenCalledWith('agente-conexoes', { body: { acao: 'criar', nome: 'x', dias: 90, permissoes: ['margens'] } });

    expect(qc.getMutationCache().getAll()).toHaveLength(0);
    for (const q of qc.getQueryCache().getAll()) {
      expect(JSON.stringify(q.state.data ?? null)).not.toContain(CHAVE);
      expect(JSON.stringify(q.queryKey)).not.toContain(CHAVE);
    }
  });
});

describe('alterarPermissoesAgente', () => {
  it('chama a ação permissoes com id e lista', async () => {
    m.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await alterarPermissoesAgente('c1', ['catalogo']);
    expect(m.invoke).toHaveBeenLastCalledWith('agente-conexoes', { body: { acao: 'permissoes', id: 'c1', permissoes: ['catalogo'] } });
  });
});
