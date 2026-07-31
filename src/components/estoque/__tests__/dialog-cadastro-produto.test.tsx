// Task 5, fix round 1, Achado 3: o ciclo de vida de `chaveCadastro` é a propriedade que
// sustenta a idempotência das Tasks 4/4b (guard de divergência, comparação de custo). Se
// alguém trocar a chave a cada submit (ex.: "limpar" o formulário no clique), nenhum teste
// da edge acusa — só um teste deste diálogo protege essa invariante.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCadastroProduto } from '../dialog-cadastro-produto';

const cadastrarProdutoMock = vi.fn().mockRejectedValue(new Error('falhou'));

vi.mock('@/lib/produtos-saldo', () => ({
  cadastrarProduto: (...args: unknown[]) => cadastrarProdutoMock(...args),
  uploadFotoProduto: vi.fn(),
  ProdutoJaExisteError: class ProdutoJaExisteError extends Error {
    constructor(mensagem: string, readonly familiaId: string, readonly loteId: string) {
      super(mensagem);
    }
  },
}));

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DialogCadastroProduto aberto onFechar={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DialogCadastroProduto — ciclo de vida da chaveCadastro', () => {
  it('submit que falha e resubmit reenviam a MESMA chaveCadastro', async () => {
    const user = userEvent.setup();
    renderDialog();

    // DialogContent (Radix) faz portal pro document.body — fora do container do render, por
    // isso a busca é em `document`, não em `container`.
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    const precoInput = document.querySelector('table tbody tr td:nth-child(3) input') as HTMLInputElement;
    await user.type(precoInput, '10');

    const botao = screen.getByRole('button', { name: 'Cadastrar' });
    await user.click(botao);
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));

    await user.click(botao);
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(2));

    const chave1 = cadastrarProdutoMock.mock.calls[0][0].chaveCadastro;
    const chave2 = cadastrarProdutoMock.mock.calls[1][0].chaveCadastro;
    expect(chave1).toBeTruthy();
    expect(chave2).toBe(chave1);
  });
});
