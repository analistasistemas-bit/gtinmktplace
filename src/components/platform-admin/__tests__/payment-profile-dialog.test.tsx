import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentProfileDialog } from '../payment-profile-dialog';

const mocks = vi.hoisted(() => ({ save: vi.fn(), profile: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePaymentProfile: mocks.profile,
  useSavePaymentProfile: () => ({ mutateAsync: mocks.save, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({});
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.profile.mockReturnValue({ data: null, isLoading: false });
});
afterEach(cleanup);

async function preencher(user: ReturnType<typeof userEvent.setup>, o: { documento?: string } = {}) {
  await user.type(screen.getByLabelText('Favorecido'), 'DALUDI EXEMPLO LTDA');
  await user.type(screen.getByLabelText('Documento'), o.documento ?? '11.222.333/0001-81');
  await user.type(screen.getByLabelText('Cidade'), 'Fortaleza');
  await user.type(screen.getByLabelText('Banco'), 'Banco Exemplo');
  await user.type(screen.getByLabelText('Agência'), '0001');
  await user.type(screen.getByLabelText('Conta'), '12345-6');
  await user.type(screen.getByLabelText('Chave Pix'), '11222333000181');
}

describe('PaymentProfileDialog', () => {
  it('usa o Select do DS, nunca <select> nativo', () => {
    const { baseElement } = render(<PaymentProfileDialog open onOpenChange={() => {}} />);
    expect(baseElement.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Tipo da chave Pix' })).toBeInTheDocument();
  });

  it('valida inline (documento inválido) e não envia', async () => {
    const user = userEvent.setup();
    render(<PaymentProfileDialog open onOpenChange={() => {}} />);
    await preencher(user, { documento: '123' });
    await user.click(screen.getByRole('button', { name: 'Salvar dados' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Documento deve ser CPF ou CNPJ válido');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('cidade acima do limite do Pix aponta o campo', async () => {
    const user = userEvent.setup();
    render(<PaymentProfileDialog open onOpenChange={() => {}} />);
    await preencher(user);
    await user.clear(screen.getByLabelText('Cidade'));
    await user.type(screen.getByLabelText('Cidade'), 'Cidade Com Nome Muito Longo');
    await user.click(screen.getByRole('button', { name: 'Salvar dados' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cidade deve ter até 15 caracteres');
    expect(screen.getByLabelText('Cidade')).toHaveAttribute('aria-invalid', 'true');
  });

  it('envia os dados normalizados e fecha', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<PaymentProfileDialog open onOpenChange={onOpenChange} />);
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Salvar dados' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith({
      beneficiary_name: 'DALUDI EXEMPLO LTDA', document: '11222333000181', bank_name: 'Banco Exemplo', branch: '0001',
      account: '12345-6', pix_key_type: 'cnpj', pix_key: '11222333000181', city: 'Fortaleza',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Dados de recebimento salvos.');
  });

  it('pré-preenche com o cadastro existente', () => {
    mocks.profile.mockReturnValue({
      isLoading: false,
      data: {
        beneficiary_name: 'DALUDI EXEMPLO LTDA', document: '11222333000181', bank_name: 'Banco Exemplo', branch: '0001', account: '1',
        pix_key_type: 'cnpj', pix_key: '11222333000181', city: 'FORTALEZA', updated_at: '', updated_by: '',
      },
    });
    render(<PaymentProfileDialog open onOpenChange={() => {}} />);
    expect(screen.getByLabelText('Favorecido')).toHaveValue('DALUDI EXEMPLO LTDA');
  });
});
