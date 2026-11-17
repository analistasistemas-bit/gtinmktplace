import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FunctionRegion } from '@supabase/supabase-js';
import type { RespostaReposicao } from '../../../supabase/functions/_shared/reposicao/tipos';
import type { SugestaoSku } from '../../../supabase/functions/_shared/reposicao/calculo';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: m.invoke } } }));

const { montarVisao, useReposicao } = await import('../useReposicao');

const VAZIO: RespostaReposicao = { config: null, resultado: null, skus: [], familias: [], naoRepor: [], rascunhos: [], pedidos: [] };

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const inval = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return { ...renderHook(() => useReposicao(), { wrapper }), inval };
}

/** Erro HTTP do supabase-js: `context` é a Response. */
const erroHttp = (corpo: unknown) => ({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(corpo), { status: 409 }) });

beforeEach(() => {
  m.invoke.mockReset();
  m.invoke.mockImplementation((_n: string, o: { method?: string }) => Promise.resolve({ data: o.method === 'GET' ? VAZIO : { ok: true }, error: null }));
});

describe('useReposicao', () => {
  it('GET vai para us-east-1, como o resto do app', async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toEqual(VAZIO));
    expect(m.invoke).toHaveBeenCalledWith('reposicao', { method: 'GET', region: FunctionRegion.UsEast1 });
  });

  it('aprovar repassa a ref recebida (sem gerar outra) e invalida ["reposicao"]', async () => {
    const { result, inval } = montar();
    await waitFor(() => expect(result.current.data).toBeDefined());
    await act(() => result.current.aprovar({ pedidoId: 'p1', ref: 'ref-fixa' }));
    await act(() => result.current.aprovar({ pedidoId: 'p1', ref: 'ref-fixa' }));
    const corpos = m.invoke.mock.calls.filter(([, o]) => o.body).map(([, o]) => o.body);
    expect(corpos).toEqual([{ action: 'aprovar', pedidoId: 'p1', ref: 'ref-fixa' }, { action: 'aprovar', pedidoId: 'p1', ref: 'ref-fixa' }]);
    expect(inval).toHaveBeenCalledWith({ queryKey: ['reposicao'] });
  });

  it('erro {error} com corpo JSON vira a mensagem', async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toBeDefined());
    m.invoke.mockResolvedValueOnce({ data: null, error: erroHttp({ error: 'Só administrador aprova o pedido.' }) });
    await expect(result.current.aprovar({ pedidoId: 'p1', ref: 'r' })).rejects.toThrow('Só administrador aprova o pedido.');
  });

  it('erro de rede (sem Response) vira mensagem em pt-BR, nunca o texto cru em inglês', async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toBeDefined());
    m.invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Failed to fetch') } });
    await expect(result.current.removerNaoRepor('x')).rejects.toThrow('Não foi possível falar com o servidor. Confira a conexão e tente de novo.');
  });
});

function sug(p: Partial<SugestaoSku> & { codigo: string }): SugestaoSku {
  return {
    codigoPai: 'A', propria: 0, diasDisponiveis: 30, unidades: 3, w: 1, usada: 0, picoLimitadoEm: [], vendasEmOferta: 0,
    estoqueHoje: 0, v: 1, aCaminho: 0, chegaEm: null, diasDeEstoque: 0, pedirAntesMultiplo: 0, pedir: 0,
    urgencia: 'em_dia', poucoHistorico: false, ...p,
  };
}
const tela = (codigo: string, naoReporId: string | null = null) =>
  ({ codigo, codigoPai: 'A', cor: 'Azul', corHex: null, tamanho: codigo, custo: 10, preco: 20, naoReporId });

describe('montarVisao', () => {
  const dados = (): RespostaReposicao => ({
    config: { prazo: 10, cobertura: 30 },
    resultado: {
      pctEstimadoPelaFamilia: 0,
      familias: [{ codigoPai: 'A', pedir: 2, pedirAntesMultiplo: 2, tendencia: null, urgencia: 'ruptura' }],
      skus: [
        sug({ codigo: 'P', urgencia: 'ruptura', aCaminho: 5, chegaEm: '2026-12-01' }),
        sug({ codigo: 'M', urgencia: 'ruptura', v: 3 }),
        sug({ codigo: 'G', urgencia: 'pedir_agora', pedir: 2, estoqueHoje: 1, aCaminho: 3, chegaEm: '2026-11-20' }),
      ],
    },
    skus: [tela('P'), tela('M', 'nr'), tela('G')],
    familias: [{ codigoPai: 'A', nome: 'Camisa', fornecedor: { id: null, nome: '' }, multiplo: 1 }],
    naoRepor: [{ id: 'nr', escopo: 'sku', codigoPai: 'A', codigo: 'M', cor: null }],
    rascunhos: [], pedidos: [],
  });

  it('SKU em Não repor fica fora das faixas e da venda perdida', () => {
    const v = montarVisao(dados(), '2026-11-16');
    expect(v.cards.ruptura).toEqual({ skus: 1, produtos: 1 });
    expect(v.cards.vendaPerdidaDia).toBe(20); // só P (v 1 × 20); M (v 3) está em Não repor
    const d = dados();
    d.skus = [tela('P', 'nr'), tela('M', 'nr'), tela('G')];
    const v2 = montarVisao(d, '2026-11-16');
    expect(v2.cards.ruptura).toEqual({ skus: 0, produtos: 0 });
    expect(v2.familias[0].urgencia).toBe('pedir_agora');
  });

  it('fornecedor vazio não conta no card Sugerido', () => {
    expect(montarVisao(dados(), '2026-11-16').cards.sugerido.fornecedores).toBe(0);
  });

  it('chegaEm da família = menor data entre os SKUs em ruptura', () => {
    expect(montarVisao(dados(), '2026-11-16').familias[0].chegaEm).toBe('2026-12-01');
  });
});
