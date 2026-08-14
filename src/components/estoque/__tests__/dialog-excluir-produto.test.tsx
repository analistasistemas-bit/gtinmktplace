import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogExcluirProduto } from '../dialog-excluir-produto';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

const excluir = vi.fn();
vi.mock('@/lib/excluir', async (orig) => ({
  ...(await orig<typeof import('@/lib/excluir')>()),
  excluirProduto: (...a: unknown[]) => excluir(...a),
}));

const produto = {
  codigoPai: '00000026',
  nomePai: 'Creme Multirreparador Calmante',
  saldoTotal: 12,
  qtdSkus: 1,
} as unknown as ProdutoEstoqueResumo;

function montar(onFechar = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogExcluirProduto produto={produto} aberto onFechar={onFechar} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  excluir.mockReset();
  excluir.mockResolvedValue({ ok: true, familias_removidas: 1, lotes_removidos: 1, movimentos_removidos: 2 });
});

describe('DialogExcluirProduto', () => {
  it('só habilita o botão quando o código digitado bate', () => {
    montar();
    const botao = screen.getByRole('button', { name: 'Excluir produto' });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/para confirmar/i), { target: { value: '00000027' } });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/para confirmar/i), { target: { value: '00000026' } });
    expect(botao).toBeEnabled();
  });

  it('avisa do saldo em estoque sem bloquear a exclusão (ADR-0113 D-7)', async () => {
    const onFechar = vi.fn();
    montar(onFechar);
    expect(screen.getByText(/ainda tem 12 unidades em estoque/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/para confirmar/i), { target: { value: '00000026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir produto' }));

    await waitFor(() => expect(excluir).toHaveBeenCalledWith('00000026'));
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
  });
});
