import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogAjuste } from '../dialog-ajuste';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

const ajustar = vi.fn();
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  ajustarEstoque: (...a: unknown[]) => ajustar(...a),
}));

const produto = {
  codigoPai: '26705343',
  nomePai: 'Tecido Helanca Light',
  variacoes: [
    { codigo: '18760903', cor: 'Vermelho', nome: null, estoque: 1990 },
    { codigo: '26706073', cor: 'Azul', nome: null, estoque: 10 },
  ],
} as unknown as ProdutoComSaldo;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogAjuste produto={produto} aberto onFechar={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ajustar.mockReset();
  ajustar.mockResolvedValue({ resultados: [{ codigo: '18760903', estoque: 0, duplicada: false }], pushOk: true });
});

describe('DialogAjuste', () => {
  it('mostra uma linha por variação com o saldo atual pré-preenchido', () => {
    montar();
    expect(screen.getByLabelText('Novo saldo de 18760903')).toHaveValue(1990);
    expect(screen.getByLabelText('Novo saldo de 26706073')).toHaveValue(10);
  });

  it('"Zerar tudo" preenche 0 em todas as linhas', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Zerar tudo' }));
    expect(screen.getByLabelText('Novo saldo de 18760903')).toHaveValue(0);
    expect(screen.getByLabelText('Novo saldo de 26706073')).toHaveValue(0);
  });

  it('"Zerar" por linha não mexe nas outras', () => {
    montar();
    fireEvent.click(screen.getAllByRole('button', { name: 'Zerar' })[0]);
    expect(screen.getByLabelText('Novo saldo de 18760903')).toHaveValue(0);
    expect(screen.getByLabelText('Novo saldo de 26706073')).toHaveValue(10);
  });

  it('recusa valor acima do saldo atual e aponta para a Entrada', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Novo saldo de 26706073'), { target: { value: '50' } });
    expect(screen.getByText(/só reduz.*Entrada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();
  });

  it('mantém Confirmar desabilitado quando nada mudou', () => {
    montar();
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();
  });

  it('envia só as linhas que mudaram, com uma ref por submissão', async () => {
    montar();
    fireEvent.change(screen.getByLabelText('Novo saldo de 18760903'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(ajustar).toHaveBeenCalledTimes(1));
    const arg = ajustar.mock.calls[0][0];
    expect(arg.ajustes).toEqual([{ codigo: '18760903', novoSaldo: 0 }]);
    expect(typeof arg.ref).toBe('string');
    expect(arg.ref.length).toBeGreaterThan(10);
  });

  it('envia a observação quando preenchida', async () => {
    montar();
    fireEvent.change(screen.getByLabelText('Novo saldo de 18760903'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Observação/), { target: { value: 'venda no balcão' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(ajustar).toHaveBeenCalledTimes(1));
    expect(ajustar.mock.calls[0][0].observacao).toBe('venda no balcão');
  });

  it('avisa que um cancelamento posterior repõe o saldo', () => {
    montar();
    expect(screen.getByText(/cancelado.*rep(õe|oe)/i)).toBeInTheDocument();
  });

  it('mostra o total que sai do saldo', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Zerar tudo' }));
    expect(screen.getByText(/−2000/)).toBeInTheDocument();
  });
});
