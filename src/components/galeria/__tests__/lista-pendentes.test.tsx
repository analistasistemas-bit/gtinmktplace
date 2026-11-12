import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ListaPendentesGaleria } from '../lista-pendentes';
import type { PendenteGaleria, Res } from '@/lib/galeria/api';

const api = vi.hoisted(() => ({ listarPendentes: vi.fn() }));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));

const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const linha = (extra: Partial<PendenteGaleria> = {}): PendenteGaleria => ({
  ml_item_id: 'MLB7168683146', titulo: 'Fita Velcro Adesiva 20mm', cor: 'Branco', prontas: 7, aguardando_aprovacao: 0, aplicando: false, ...extra,
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/publicados?aba=imagens']}>
        <Routes>
          <Route path="/publicados" element={<ListaPendentesGaleria />} />
          <Route path="/publicados/:mlItemId/galeria" element={<p>tela da galeria</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => api.listarPendentes.mockReset());

describe('ListaPendentesGaleria', () => {
  it('mostra anúncio, cor e quantas imagens prontas esperam aplicação', async () => {
    api.listarPendentes.mockResolvedValue(ok({ pendentes: [linha(), linha({ ml_item_id: 'MLB1', titulo: 'Fio Amigurumi', cor: 'Netuno', prontas: 3, aguardando_aprovacao: 2 })] }));
    montar();
    const l1 = (await screen.findByText('Fita Velcro Adesiva 20mm')).closest('li')!;
    expect(within(l1).getByText('Branco')).toBeTruthy();
    expect(within(l1).getByText(/7 prontas para aplicar/)).toBeTruthy();
    const l2 = screen.getByText('Fio Amigurumi').closest('li')!;
    expect(within(l2).getByText(/3 prontas para aplicar/)).toBeTruthy();
    expect(within(l2).getByText(/2 aguardando aprovação/)).toBeTruthy();
  });

  it('o botão leva à galeria do anúncio', async () => {
    api.listarPendentes.mockResolvedValue(ok({ pendentes: [linha()] }));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /Abrir galeria/ }));
    expect(await screen.findByText('tela da galeria')).toBeTruthy();
  });

  it('cor com aplicação em andamento mostra "Aplicando"', async () => {
    api.listarPendentes.mockResolvedValue(ok({ pendentes: [linha({ prontas: 0, aguardando_aprovacao: 1, aplicando: true })] }));
    montar();
    expect(await screen.findByText('Aplicando')).toBeTruthy();
  });

  it('sem pendências: diz que está tudo aplicado', async () => {
    api.listarPendentes.mockResolvedValue(ok({ pendentes: [] }));
    montar();
    expect(await screen.findByText(/Nada pendente/)).toBeTruthy();
  });

  it('falha ao carregar: mostra o erro e o botão de tentar de novo', async () => {
    api.listarPendentes.mockResolvedValueOnce({ ok: false, status: 500, erro: 'falha_interna', corpo: {} });
    montar();
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy();
    api.listarPendentes.mockResolvedValueOnce(ok({ pendentes: [linha()] }));
    await userEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByText('Fita Velcro Adesiva 20mm')).toBeTruthy();
  });
});
