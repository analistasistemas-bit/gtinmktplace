import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogEntrada } from '../dialog-entrada';

const fetchSkusEstoqueOrgMock = vi.fn(() => Promise.resolve([
  { codigo: '00000005', codigoPai: '00000004', nome: 'Protetor Solar', cor: 'incolor', estoque: 5 },
  { codigo: '00000006', codigoPai: '00000004', nome: 'Protetor Solar', cor: 'bege', estoque: 5 },
  { codigo: '00000010', codigoPai: '00000009', nome: 'Outro Produto', cor: 'única', estoque: 5 },
]));

vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchSkusEstoqueOrg: () => fetchSkusEstoqueOrgMock(),
  registrarEntrada: vi.fn(),
}));

describe('DialogEntrada', () => {
  it('filtroInicial pelo código do pai lista só as variações daquele produto', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DialogEntrada aberto onFechar={() => {}} filtroInicial="00000004" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/00000005/)).toBeInTheDocument();
    expect(screen.getByText(/00000006/)).toBeInTheDocument();
    expect(screen.queryByText(/00000010/)).toBeNull();
  });
});
