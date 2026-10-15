import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { salvarAliquotas, salvarEmpresa, buscarCep, estado } = vi.hoisted(() => ({
  salvarAliquotas: vi.fn(async (_s: Record<string, unknown>) => undefined),
  // Aplica o patch no estado, como o refetch do invalidateQueries faria — o teste re-renderiza
  // e confere os inputs, não só as chamadas.
  salvarEmpresa: vi.fn(async (p: Record<string, unknown>) => {
    estado.empresa = { ...(estado.empresa as object | null), ...p };
  }),
  buscarCep: vi.fn(),
  estado: { aliquotas: null as unknown, empresa: null as Record<string, unknown> | null },
}));

vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: estado.aliquotas, isLoading: false }),
  useSalvarAliquotas: () => ({ mutateAsync: salvarAliquotas, isSuccess: false }),
  useEmpresaFiscal: () => ({ data: estado.empresa, isLoading: false }),
  useSalvarEmpresaFiscal: () => ({ mutateAsync: salvarEmpresa, isSuccess: false }),
}));
vi.mock('@/components/configuracoes/permissoes', () => ({
  usePermissoesConfig: () => ({ podeEditarConfig: true, podeEditarEmpresa: true }),
}));
vi.mock('@/lib/cep', () => ({ buscarCep }));

import { SecaoFiscal } from '../secao-fiscal';

// Radix Select usa pointer capture e scrollIntoView, que o jsdom não implementa.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const ALIQ = { nacional: 8, importado: 16, ufEmpresa: null, internaPct: null, confirmada: true };

function renderSecao(o: { aliquotas?: object; empresa?: Record<string, unknown> | null } = {}) {
  estado.aliquotas = { ...ALIQ, ...o.aliquotas };
  estado.empresa = o.empresa === undefined ? null : { ...o.empresa };
  return render(<SecaoFiscal />);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Venda dentro do estado — dropdown de UF', () => {
  it('lista as 27 UFs + Nenhuma e grava UF+% juntos', async () => {
    const user = userEvent.setup();
    renderSecao({ aliquotas: { internaPct: 4 } });
    await user.click(screen.getByRole('combobox', { name: 'UF da venda dentro do estado' }));
    expect(await screen.findAllByRole('option')).toHaveLength(28);
    await user.click(screen.getByRole('option', { name: 'PE' }));
    await waitFor(() => expect(salvarAliquotas).toHaveBeenCalledWith(
      expect.objectContaining({ ufEmpresa: 'PE', internaPct: 4 })));
  });
  it('"Nenhuma" limpa UF e % juntos (não cai na meia-configuração)', async () => {
    const user = userEvent.setup();
    renderSecao({ aliquotas: { ufEmpresa: 'PE', internaPct: 4 } });
    await user.click(screen.getByRole('combobox', { name: 'UF da venda dentro do estado' }));
    await user.click(await screen.findByRole('option', { name: 'Nenhuma' }));
    await waitFor(() => expect(salvarAliquotas).toHaveBeenCalledWith(
      expect.objectContaining({ ufEmpresa: null, internaPct: null })));
    expect(screen.getByLabelText('Alíquota dentro do estado')).toHaveValue(null);
  });
});
