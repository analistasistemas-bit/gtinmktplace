import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// O card Empresa virou o bloco Empresa da seção Fiscal (2026-08-28); a validação de CNPJ e o
// patch por campo no blur continuam iguais (ADR-0135). A gravação passou a ser enfileirada
// (single-flight por tabela), então o assert espera a promessa.
import { SecaoFiscal } from '@/components/configuracoes/secao-fiscal';

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (seletor: (s: unknown) => unknown) => seletor({
    profile: { is_admin: true, is_active: true, allowed_menus: ['configuracoes'], org_id: 'org-1' },
    profileLoading: false,
  }),
}));
vi.mock('@/stores/support-store', () => ({
  useSupportStore: (seletor: (s: unknown) => unknown) => seletor({ context: null }),
}));

const salvarEmpresa = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false }),
  useSalvarAliquotas: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  useEmpresaFiscal: () => ({
    data: { cnpj: null, razao_social: null, regime_tributario: null },
    isLoading: false,
  }),
  useSalvarEmpresaFiscal: () => ({ mutateAsync: salvarEmpresa }),
}));

function renderSecao() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><SecaoFiscal /></QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Configurações — bloco Empresa (ADR-0135)', () => {
  beforeEach(() => salvarEmpresa.mockClear());

  it('bloco Empresa aparece e salva CNPJ válido no blur', async () => {
    renderSecao();
    const cnpj = screen.getByLabelText(/^CNPJ$/i);
    fireEvent.change(cnpj, { target: { value: '11.222.333/0001-81' } });
    fireEvent.blur(cnpj);

    await waitFor(() =>
      expect(salvarEmpresa).toHaveBeenCalledWith(expect.objectContaining({ cnpj: '11222333000181' })));
  });

  it('CNPJ com dígito errado não salva e mostra o erro', async () => {
    renderSecao();
    const cnpj = screen.getByLabelText(/^CNPJ$/i);
    fireEvent.change(cnpj, { target: { value: '11222333000180' } });
    fireEvent.blur(cnpj);

    expect(await screen.findByText(/dígito verificador/i)).toBeInTheDocument();
    expect(salvarEmpresa).not.toHaveBeenCalled();
  });

  it('membro comum não edita a empresa: empresa_fiscal exige admin, sem escape de suporte', async () => {
    vi.resetModules();
    vi.doMock('@/stores/auth-store', () => ({
      useAuthStore: (seletor: (s: unknown) => unknown) => seletor({
        profile: { is_admin: false, is_active: true, allowed_menus: ['configuracoes'], org_id: 'org-1' },
        profileLoading: false,
      }),
    }));
    const { SecaoFiscal: FiscalMembro } = await import('@/components/configuracoes/secao-fiscal');

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}><FiscalMembro /></QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/^CNPJ$/i)).toBeDisabled();
  });
});
