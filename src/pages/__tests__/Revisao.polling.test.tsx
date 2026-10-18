import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import Revisao from '@/pages/Revisao';

// Bug 2026-10-18: o cadastro de produto navega direto para a Revisão com a família ainda
// 'pendente'. Se o evento do realtime se perde (mesma corrida que Progresso já cobre com
// polling), a tela congela no estado pré-IA: "em processamento", sem categoria, sem preço.
type Opts = { refetchInterval?: (q: { state: { data: unknown } }) => number | false | undefined };
const famOpts: { atual?: Opts } = {};
const loteOpts: { atual?: Opts } = {};

vi.mock('@/hooks/useLoteRealtime', () => ({ useLoteRealtime: vi.fn() }));
vi.mock('@/hooks/useLotes', () => ({
  useLote: (_id: string, o?: Opts) => {
    loteOpts.atual = o;
    return { data: { id: 'lote-42', status: 'revisao' }, isLoading: false, error: null };
  },
}));
vi.mock('@/hooks/useFamilias', () => ({
  useFamilias: (_id: string, o?: Opts) => {
    famOpts.atual = o;
    return { data: [], isLoading: false, error: null, isSuccess: true };
  },
}));
vi.mock('@/hooks/useCanaisHabilitados', () => ({
  useCanaisHabilitados: () => ({ data: ['mercado_livre'], isLoading: false }),
}));
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useToggleDescontoLote: () => ({ mutate: vi.fn(), isPending: false }),
  useReprocessar: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAtacadoLote: () => ({ mutate: vi.fn(), isPending: false }),
}));

const intervalo = (o: Opts | undefined, data: unknown) => o?.refetchInterval?.({ state: { data } });

describe('Revisao — polling de fallback do realtime', () => {
  it('polla famílias só enquanto alguma está pendente/processando', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/revisao/lote-42']}>
            <Routes>
              <Route path="/revisao/:loteId" element={<Revisao />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );
    await screen.findByPlaceholderText(/buscar por código ou nome/i);

    expect(intervalo(famOpts.atual, [{ status: 'pendente' }])).toBeGreaterThan(0);
    expect(intervalo(famOpts.atual, [{ status: 'pronto' }, { status: 'processando' }])).toBeGreaterThan(0);
    expect(intervalo(famOpts.atual, [{ status: 'pronto' }, { status: 'erro' }])).toBeFalsy();
    expect(intervalo(famOpts.atual, undefined)).toBeFalsy();

    expect(intervalo(loteOpts.atual, { status: 'processando' })).toBeGreaterThan(0);
    expect(intervalo(loteOpts.atual, { status: 'importando' })).toBeGreaterThan(0);
    expect(intervalo(loteOpts.atual, { status: 'revisao' })).toBeFalsy();
  });
});
