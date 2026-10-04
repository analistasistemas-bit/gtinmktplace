// D15: cor com preço fixado pelo operador mostra o selo e oferece "Voltar ao automático".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Variacao } from '@/lib/tipos-dominio';

const voltarSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  voltarPrecoAutomatico: (id: string) => voltarSpy(id),
}));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null }), invalidarImagem: vi.fn() }));
vi.mock('@/components/semaforo-preco', () => ({ SemaforoPreco: () => null }));

import { VariacaoCard } from '../variacao-card';
import { QK } from '@/lib/queries';

const base: Variacao = {
  id: 'v1', codigo: '92710170', cor: 'Natal', tamanho: null, corHex: '#ccc', corOrigem: 'descricao',
  corEditadaPeloOperador: false, preco: 78.9, precoPublicacao: 99.9, precoPublicadoMl: null,
  estoque: 10, gtin: null, excluidaDaPublicacao: false, mlVariationId: null,
  estoqueAnterior: null, custo: 40, pesoGramas: 100, alturaCm: 1, larguraCm: 1, comprimentoCm: 1,
  atacado: null,
};

function renderCard(variacao: Variacao, qc = new QueryClient()) {
  const ui = (v: Variacao) => (
    <QueryClientProvider client={qc}>
      <VariacaoCard variacao={v} loteId="lote-1" onMudarPreco={vi.fn()} onMudarCor={vi.fn()} categoriaMlId={null} aliquotaPct={16} />
    </QueryClientProvider>
  );
  const r = render(ui(variacao));
  return { ...r, rerenderCom: (v: Variacao) => r.rerender(ui(v)) };
}

afterEach(cleanup);

describe('VariacaoCard — preço fixado pelo operador', () => {
  it('sem a marca não mostra selo nem ação', () => {
    renderCard({ ...base, editadoPeloOperador: false });
    expect(screen.queryByText(/preço fixado/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /voltar ao automático/i })).not.toBeInTheDocument();
  });

  it('com a marca mostra o selo com a explicação (e não o "sugerido pela IA")', () => {
    renderCard({ ...base, editadoPeloOperador: true });
    expect(screen.queryByText(/sugerido pela IA/i)).not.toBeInTheDocument();
    expect(screen.getByText(/preço fixado/i).closest('[title]')).toHaveAttribute(
      'title', 'Preço fixado pelo operador — mantido nos próximos lotes',
    );
  });

  it('"Voltar ao automático" confirma, chama a mutation, invalida a família e o selo some após refetch', async () => {
    const qc = new QueryClient();
    const inval = vi.spyOn(qc, 'invalidateQueries');
    const { rerenderCom } = renderCard({ ...base, editadoPeloOperador: true }, qc);
    await userEvent.click(screen.getByRole('button', { name: /voltar ao automático/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('O preço desta cor volta a ser calculado no próximo lote.')).toBeInTheDocument();
    expect(voltarSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: /voltar ao automático/i }));
    await waitFor(() => expect(voltarSpy).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(inval).toHaveBeenCalledWith({ queryKey: QK.familias('lote-1') }));
    rerenderCom({ ...base, editadoPeloOperador: false });
    expect(screen.queryByText(/preço fixado/i)).not.toBeInTheDocument();
  });
});
