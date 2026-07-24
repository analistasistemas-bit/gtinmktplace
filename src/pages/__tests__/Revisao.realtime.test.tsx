import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import Revisao from '@/pages/Revisao';

// Achado 2026-07-22 (docs/TASKS.md): depois de "Reenviar", a Revisão fica presa
// no status antigo até F5 — a tela nunca liga o realtime que Progresso/Relatorio
// já usam para pegar a conclusão assíncrona do reprocessamento.
const useLoteRealtimeMock = vi.fn();
vi.mock('@/hooks/useLoteRealtime', () => ({
  useLoteRealtime: (loteId: string | undefined) => useLoteRealtimeMock(loteId),
}));

vi.mock('@/hooks/useLotes', () => ({
  useLote: () => ({ data: { id: 'lote-42', status: 'concluido' }, isLoading: false, error: null }),
}));
vi.mock('@/hooks/useFamilias', () => ({
  useFamilias: () => ({ data: [], isLoading: false, error: null, isSuccess: true }),
}));
vi.mock('@/hooks/useCanaisHabilitados', () => ({
  useCanaisHabilitados: () => ({ data: ['mercado_livre'], isLoading: false }),
}));
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useToggleDescontoLote: () => ({ mutate: vi.fn(), isPending: false }),
  useReprocessar: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAtacadoLote: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderRevisao(loteId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/revisao/${loteId}`]}>
          <Routes>
            <Route path="/revisao/:loteId" element={<Revisao />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe('Revisao — realtime de status da família', () => {
  it('liga useLoteRealtime com o loteId da rota (mesmo padrão de Progresso/Relatorio)', async () => {
    renderRevisao('lote-42');
    await screen.findByPlaceholderText(/buscar por código ou nome/i);

    expect(useLoteRealtimeMock).toHaveBeenCalledWith('lote-42');
  });
});
