import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewStatus } from '../preview-status';
import { ErroOperacao, useCriarOperacao, usePodeExecutarOperacao } from '@/hooks/useOperacoes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useOperacoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes');
  return { ...actual, useCriarOperacao: vi.fn(), usePodeExecutarOperacao: vi.fn() };
});

const mutateAsync = vi.fn(async () => ({ operacao_id: 'OP9' }));
beforeEach(() => {
  vi.mocked(useCriarOperacao).mockReturnValue({ mutateAsync, isPending: false } as never);
  vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
  mutateAsync.mockClear();
});
const itens = [{ ml_item_id: 'MLB1', titulo: 'Toalha Azul' }, { ml_item_id: 'MLB2', titulo: 'Toalha Verde' }];

describe('PreviewStatus', () => {
  it('pausar: lista, avisos de catálogo e de estoque, executa com os ids', async () => {
    const onCriada = vi.fn();
    render(<PreviewStatus acao="pausar" itens={itens} foraDoLote={[{ motivo: 'Kit Virtual', quantidade: 1 }]}
      origemId={null} aberto onFechar={() => {}} onCriada={onCriada} />);
    expect(screen.getByText('Toalha Azul')).toBeInTheDocument();
    expect(screen.getByText(/catálogo ligados a estes também mudam/i)).toBeInTheDocument();
    expect(screen.getByText(/repor estoque reativa/i)).toBeInTheDocument();
    expect(screen.getByText(/1 fora do lote: Kit Virtual/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pausar 2 anúncios' }));
    expect(mutateAsync).toHaveBeenCalledWith({ acao: 'pausar', origem_id: null, itens: [
      { ml_item_id: 'MLB1', titulo: 'Toalha Azul' }, { ml_item_id: 'MLB2', titulo: 'Toalha Verde' },
    ] });
    expect(onCriada).toHaveBeenCalledWith('OP9');
  });
  it('reativar não mostra o aviso de estoque', () => {
    render(<PreviewStatus acao="reativar" itens={itens} foraDoLote={[]} origemId={null} aberto onFechar={() => {}} onCriada={() => {}} />);
    expect(screen.queryByText(/repor estoque reativa/i)).not.toBeInTheDocument();
  });
  it('recusa da edge mostra cada anúncio e o motivo', async () => {
    mutateAsync.mockRejectedValueOnce(new ErroOperacao('Alguns anúncios não podem entrar na operação.', [
      { ml_item_id: 'MLB2', motivo: 'O anúncio não é desta organização' },
    ]));
    render(<PreviewStatus acao="pausar" itens={itens} foraDoLote={[]} origemId={null} aberto onFechar={() => {}} onCriada={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pausar 2 anúncios' }));
    expect(await screen.findByText(/Toalha Verde \(MLB2\): O anúncio não é desta organização/)).toBeInTheDocument();
  });
  it('membro comum vê o preview mas não executa', () => {
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
    render(<PreviewStatus acao="pausar" itens={itens} foraDoLote={[]} origemId={null} aberto onFechar={() => {}} onCriada={() => {}} />);
    expect(screen.queryByRole('button', { name: /Pausar 2/ })).not.toBeInTheDocument();
    expect(screen.getByText('Só administradores executam.')).toBeInTheDocument();
  });
});
