import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { OrgSettings } from '../org-settings';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const org = {
  id: 'org-a',
  nome: 'Avil',
  slug: 'avil',
  canais_habilitados: ['mercado_livre'],
  modulos_habilitados: [],
  tipo_pessoa: 'pj' as const,
};

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgSettings orgId="org-a" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
    if (body.action === 'list_orgs') return { data: { orgs: [org] }, error: null };
    return { data: {}, error: null };
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
});

describe('OrgSettings', () => {
  it('renderiza sem o card de Suporte operacional — a ação migrou para o cabeçalho', async () => {
    renderSettings();
    await screen.findByText('Cadastro');
    expect(screen.queryByText('Suporte operacional')).not.toBeInTheDocument();
    expect(screen.queryByText('Solicitar acesso')).not.toBeInTheDocument();
  });

  it('salva com sucesso: toast + "✓ Salvo" inline, nunca no lugar do erro', async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText('Cadastro');

    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('✓ Tipo de pessoa atualizado.'));
    expect(await screen.findByText('✓ Salvo')).toBeInTheDocument();
  });

  it('erro fica no card que falhou, sem ocupar o slot de sucesso', async () => {
    mocks.invoke.mockImplementation(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === 'list_orgs') return { data: { orgs: [org] }, error: null };
      if (body.action === 'set_tipo_pessoa_org') return { data: { error: 'Falha ao salvar cadastro.' }, error: null };
      return { data: {}, error: null };
    });
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText('Cadastro');

    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao salvar cadastro.');
    expect(screen.queryByText('✓ Salvo')).not.toBeInTheDocument();
  });

  it('usa Select do shadcn para Tipo de pessoa (sem <select> nativo)', async () => {
    renderSettings();
    await screen.findByText('Cadastro');
    expect(screen.getByRole('combobox', { name: 'Tipo de pessoa' })).toBeInTheDocument();
    expect(document.querySelector('select')).not.toBeInTheDocument();
  });
});
