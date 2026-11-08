import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const m = vi.hoisted(() => ({ excluirFamilia: vi.fn(), success: vi.fn(), error: vi.fn(), nav: vi.fn() }));
vi.mock('@/lib/excluir', () => ({ excluirFamilia: m.excluirFamilia }));
vi.mock('sonner', () => ({ toast: { success: m.success, error: m.error, warning: vi.fn() } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => m.nav }));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null }) }));
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useReprocessar: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateFamiliaAtacado: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { TirarDaRevisao } from '../tirar-da-revisao';
import { FamiliaRow } from '../familia-row';
import type { Familia } from '@/lib/tipos-dominio';

const fam = (over: Partial<Familia> = {}) =>
  ({ id: 'f1', loteId: 'l1', codigoPai: '123', titulo: 'Tênis X', status: 'pronto', operacao: 'CREATE', variacoes: [], ...over }) as unknown as Familia;

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
const abrir = () => fireEvent.click(screen.getByRole('button', { name: 'Tirar da revisão' }));
const confirmarBtn = () => screen.getAllByRole('button', { name: 'Tirar da revisão' }).at(-1)!;

describe('TirarDaRevisao', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirmar chama excluirFamilia com o id, chama onTirada e mostra toast de sucesso', async () => {
    m.excluirFamilia.mockResolvedValue({ ok: true, lote_removido: false });
    const onTirada = vi.fn();
    wrap(<TirarDaRevisao familia={fam()} onTirada={onTirada} />);
    abrir();
    fireEvent.click(confirmarBtn());
    await waitFor(() => expect(onTirada).toHaveBeenCalledWith('f1'));
    expect(m.excluirFamilia).toHaveBeenCalledWith('f1');
    expect(m.success).toHaveBeenCalledWith('Família tirada da revisão');
    expect(m.nav).not.toHaveBeenCalled();
  });

  it('cancelar não chama excluirFamilia', () => {
    wrap(<TirarDaRevisao familia={fam()} onTirada={vi.fn()} />);
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(m.excluirFamilia).not.toHaveBeenCalled();
  });

  it('409 da edge vira toast.error com a mensagem e não chama onTirada', async () => {
    m.excluirFamilia.mockRejectedValue(new Error('Família já publicada — use a tela Publicados.'));
    const onTirada = vi.fn();
    wrap(<TirarDaRevisao familia={fam()} onTirada={onTirada} />);
    abrir();
    fireEvent.click(confirmarBtn());
    await waitFor(() => expect(m.error).toHaveBeenCalledWith('Não foi possível tirar', {
      description: 'Família já publicada — use a tela Publicados.',
    }));
    expect(onTirada).not.toHaveBeenCalled();
  });

  it('lote_removido true navega para /', async () => {
    m.excluirFamilia.mockResolvedValue({ ok: true, lote_removido: true });
    wrap(<TirarDaRevisao familia={fam()} onTirada={vi.fn()} />);
    abrir();
    fireEvent.click(confirmarBtn());
    await waitFor(() => expect(m.nav).toHaveBeenCalledWith('/'));
  });
});

describe('FamiliaRow + Tirar da revisão', () => {
  const row = (f: Familia, onTirada?: (id: string) => void) =>
    wrap(<FamiliaRow familia={f} selecionada={false} expandida={false} onSelecionar={vi.fn()} onExpandir={vi.fn()} onTirada={onTirada} />);
  const botao = () => screen.queryByRole('button', { name: 'Tirar da revisão' });

  it('mostra o botão para pronto/erro com onTirada; esconde sem onTirada ou com status publicado|publicando|pendente', () => {
    for (const status of ['pronto', 'erro'] as const) {
      const r = row(fam({ status }), vi.fn());
      expect(botao()).toBeInTheDocument();
      r.unmount();
    }
    const sem = row(fam({ status: 'pronto' }));
    expect(botao()).not.toBeInTheDocument();
    sem.unmount();
    for (const status of ['publicado', 'publicando', 'pendente'] as const) {
      const r = row(fam({ status }), vi.fn());
      expect(botao()).not.toBeInTheDocument();
      r.unmount();
    }
  });
});
