import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogEditarMarca } from '../dialog-editar-marca';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Extra = { carregando?: boolean; erroLeitura?: string | null };
function ui(onOpenChange: () => void, marcaAtual: string | null, extra: Extra = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <DialogEditarMarca open onOpenChange={onOpenChange} codigoPai="00000004" nomePai="Polo"
        marcaAtual={marcaAtual} marcaOrg="Zaven" carregando={extra.carregando ?? false}
        erroLeitura={extra.erroLeitura ?? null} />
    </QueryClientProvider>
  );
}
function renderDialog(onOpenChange = vi.fn(), marcaAtual: string | null = null, extra: Extra = {}) {
  render(ui(onOpenChange, marcaAtual, extra));
  return onOpenChange;
}

afterEach(() => { cleanup(); invoke.mockReset(); });

describe('DialogEditarMarca', () => {
  it('começa com a marca da org e salva o texto aparado', async () => {
    invoke.mockResolvedValue({ data: { ok: true, publicado: true, status: 'pendente' }, error: null });
    const user = userEvent.setup();
    const onOpenChange = renderDialog();
    const campo = screen.getByLabelText('Marca');
    expect(campo).toHaveValue('Zaven');
    await user.clear(campo);
    await user.type(campo, '  Lacoste ');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('atualizar-marca-familia', {
      body: { codigo_pai: '00000004', marca: 'Lacoste' },
    }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('"Usar a marca da org" envia marca null', async () => {
    invoke.mockResolvedValue({ data: { ok: true, publicado: false, status: null }, error: null });
    const user = userEvent.setup();
    renderDialog(vi.fn(), 'Lacoste');
    await user.click(screen.getByRole('button', { name: 'Usar a marca da org (Zaven)' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('atualizar-marca-familia', {
      body: { codigo_pai: '00000004', marca: null },
    }));
  });

  it('marca vazia bloqueia o Salvar', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.clear(screen.getByLabelText('Marca'));
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('409 mostra a mensagem da edge e não fecha', async () => {
    const msg = 'Produto em processamento ou publicação — tente de novo quando terminar.';
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { json: async () => ({ erro: msg }) } },
    });
    const user = userEvent.setup();
    const onOpenChange = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(msg);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('carregando a marca vigente: Salvar e "Usar a marca da org" ficam desabilitados', () => {
    renderDialog(vi.fn(), null, { carregando: true });
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Usar a marca da org (Zaven)' })).toBeDisabled();
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  it('dados chegam depois: input recebe a marca do produto e a digitação não é sobrescrita', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    const { rerender } = render(ui(fn, null, { carregando: true }));
    rerender(ui(fn, 'Lacoste'));
    const campo = screen.getByLabelText('Marca');
    expect(campo).toHaveValue('Lacoste');
    await user.type(campo, 'X');
    rerender(ui(fn, 'Outra'));
    expect(screen.getByLabelText('Marca')).toHaveValue('LacosteX');
  });

  it('erro de leitura: mostra a mensagem e mantém os botões desabilitados', () => {
    renderDialog(vi.fn(), null, { erroLeitura: 'falhou ao ler' });
    expect(screen.getByRole('alert')).toHaveTextContent('falhou ao ler');
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Usar a marca da org (Zaven)' })).toBeDisabled();
  });
});
