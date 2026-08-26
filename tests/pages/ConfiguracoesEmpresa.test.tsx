import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Configuracoes from '@/pages/Configuracoes';

vi.mock('@/hooks/useMlConnection', () => ({
  useMlConnection: () => ({ data: { conectado: false }, isLoading: false }),
}));
vi.mock('@/components/config-telegram', () => ({ ConfigTelegram: () => <div /> }));

const salvarEmpresa = vi.fn();

vi.mock('@/hooks/useConfiguracoes', () => ({
  useDescontoPct: () => ({ data: 15 }),
  useSalvarDescontoPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useDescontoConcorrenciaPct: () => ({ data: 5 }),
  useSalvarDescontoConcorrenciaPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
  useSalvarAliquotas: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useReancoraLiderAtiva: () => ({ data: true }),
  useSalvarReancoraLiderAtiva: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useMostrarLucroDashboard: () => ({ data: false }),
  useSalvarMostrarLucroDashboard: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useModeloTexto: () => ({ data: 'openai/gpt-4o-mini' }),
  useSalvarModeloTexto: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useModeloImagem: () => ({ data: 'google/gemini-2.5-flash-image' }),
  useSalvarModeloImagem: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useEmpresaFiscal: () => ({ data: { cnpj: null, razao_social: null, regime_tributario: null } }),
  useSalvarEmpresaFiscal: () => ({ mutate: salvarEmpresa, isPending: false, isSuccess: false }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Configuracoes />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('Configurações — card Empresa (ADR-0135)', () => {
  beforeEach(() => salvarEmpresa.mockClear());

  it('card Empresa aparece e salva CNPJ válido no blur', () => {
    renderPage();
    const cnpj = screen.getByLabelText(/CNPJ/i);
    fireEvent.change(cnpj, { target: { value: '11.222.333/0001-81' } });
    fireEvent.blur(cnpj);
    expect(salvarEmpresa).toHaveBeenCalledWith(expect.objectContaining({ cnpj: '11222333000181' }));
  });

  it('CNPJ com dígito errado não salva e mostra o erro', () => {
    renderPage();
    const cnpj = screen.getByLabelText(/CNPJ/i);
    fireEvent.change(cnpj, { target: { value: '11222333000180' } });
    fireEvent.blur(cnpj);
    expect(salvarEmpresa).not.toHaveBeenCalled();
    expect(screen.getByText(/dígito verificador/i)).toBeInTheDocument();
  });
});
