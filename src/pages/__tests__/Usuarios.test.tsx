import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import denoCategorias from '../../../supabase/functions/_shared/notificacoes/categorias.ts?raw';
import { CATEGORIAS_NOTIFICACAO, CATEGORIAS_SO_ADMIN } from '@/lib/notificacoes-categorias';

const linhas = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: linhas.data, error: null }),
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useEnviarTesteTelegram: () => ({ isPending: false, mutate: vi.fn() }),
}));

import Usuarios from '../Usuarios';

describe('Usuarios', () => {
  it('oferece acesso ao histórico de suporte no cabeçalho', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Usuarios />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /histórico de suporte/i }))
      .toHaveAttribute('href', '/suporte');
    expect(screen.getByRole('button', { name: /convidar usuário/i }))
      .toBeInTheDocument();
  });

  const usuario = (extra: Record<string, unknown>) => ({
    id: 'u1', email: 'a@b.com', nome: 'Ana', is_admin: false, is_active: true,
    allowed_menus: [], telegram_chat_id: '123', telegram_categorias: [], ...extra,
  });

  function abrirNotificacoes(u: Record<string, unknown>) {
    linhas.data = [usuario(u)];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Usuarios />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    return screen.findByRole('button', { name: 'Notificações' }).then((b) => fireEvent.click(b));
  }

  it('não-admin: categorias gerenciais desabilitadas com "Só para admin."', async () => {
    await abrirNotificacoes({});
    expect(await screen.findByRole('checkbox', { name: /Vendas \(gerencial\)/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Resumo diário/ })).toBeDisabled();
    expect(screen.getAllByText('Só para admin.')).toHaveLength(2);
  });

  it('admin com chat de grupo: desabilitadas com "Exige conversa privada com o bot."', async () => {
    await abrirNotificacoes({ is_admin: true, telegram_chat_id: '-100555' });
    expect(await screen.findByRole('checkbox', { name: /Vendas \(gerencial\)/ })).toBeDisabled();
    expect(screen.getAllByText('Exige conversa privada com o bot.')).toHaveLength(2);
  });

  it('admin com chat privado: gerenciais habilitadas', async () => {
    await abrirNotificacoes({ is_admin: true });
    expect(await screen.findByRole('checkbox', { name: /Vendas \(gerencial\)/ })).toBeEnabled();
  });

  it('"Marcar todas" para não-admin não inclui as gerenciais', async () => {
    await abrirNotificacoes({});
    fireEvent.click(await screen.findByRole('checkbox', { name: /Marcar todas/ }));
    expect(screen.getByRole('checkbox', { name: /^Vendas\s*Nova venda/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Vendas \(gerencial\)/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Resumo diário/ })).not.toBeChecked();
  });

  it('paridade com o Deno (categorias.ts)', () => {
    const lista = (nome: string) => {
      const bloco = new RegExp(`${nome} = \\[([^\\]]*)\\]`).exec(denoCategorias)![1];
      return [...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    };
    expect([...CATEGORIAS_NOTIFICACAO]).toEqual(lista('CATEGORIAS_NOTIFICACAO'));
    expect([...CATEGORIAS_SO_ADMIN]).toEqual(lista('CATEGORIAS_SO_ADMIN'));
  });
});
