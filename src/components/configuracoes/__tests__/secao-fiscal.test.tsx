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

const EMPRESA_BASE = { cnpj: '69541033000145', regime_tributario: 'simples' };
const gravados = (): Record<string, unknown>[] => salvarEmpresa.mock.calls.map((c) => c[0]);

describe('CEP preenche o endereço (ViaCEP)', () => {
  it('normaliza a máscara, grava o CEP e os 5 campos retornados', async () => {
    buscarCep.mockResolvedValue({
      logradouro: 'Rua Padre Luiz Marques Teixeira', bairro: 'Boa Viagem',
      municipio: 'Recife', uf: 'PE', municipio_ibge: '2611606',
    });
    const user = userEvent.setup();
    const { rerender } = renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '51021-530');
    await user.tab();
    await waitFor(() => expect(gravados()).toEqual(expect.arrayContaining([
      { cep: '51021530' }, { logradouro: 'Rua Padre Luiz Marques Teixeira' }, { bairro: 'Boa Viagem' },
      { municipio: 'Recife' }, { uf: 'PE' }, { municipio_ibge: '2611606' },
    ])));
    expect(buscarCep).toHaveBeenCalledWith('51021530');
    rerender(<SecaoFiscal />); // equivale ao refetch pós-invalidateQueries
    expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Padre Luiz Marques Teixeira');
    expect(screen.getByLabelText('Bairro')).toHaveValue('Boa Viagem');
    expect(screen.getByLabelText('Município')).toHaveValue('Recife');
    expect(screen.getByLabelText('UF')).toHaveValue('PE');
    expect(screen.getByLabelText('Código IBGE do município')).toHaveValue('2611606');
  });
  it('CEP geral (logradouro/bairro vazios) não apaga o que já foi digitado', async () => {
    buscarCep.mockResolvedValue({ logradouro: '', bairro: '', municipio: 'Caruaru', uf: 'PE', municipio_ibge: '2604106' });
    const user = userEvent.setup();
    renderSecao({ empresa: { ...EMPRESA_BASE, logradouro: 'Rua X', bairro: 'Centro' } });
    await user.type(screen.getByLabelText('CEP'), '55000000');
    await user.tab();
    await waitFor(() => expect(gravados()).toContainEqual({ municipio_ibge: '2604106' }));
    expect(gravados().some((p) => 'logradouro' in p || 'bairro' in p)).toBe(false);
  });
  it('CEP com menos de 8 dígitos: erro no campo, sem consulta', async () => {
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '5102');
    await user.tab();
    expect(await screen.findByText('CEP inválido (8 dígitos).')).toBeInTheDocument();
    expect(buscarCep).not.toHaveBeenCalled();
  });
  it('CEP inexistente: CEP salvo + aviso para preencher à mão', async () => {
    buscarCep.mockResolvedValue(null);
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '99999999');
    await user.tab();
    expect(await screen.findByText(/CEP não encontrado/)).toBeInTheDocument();
    expect(gravados()).toContainEqual({ cep: '99999999' });
  });
  it('ViaCEP fora do ar: aviso e endereço segue editável', async () => {
    buscarCep.mockRejectedValue(new Error('rede'));
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '51021530');
    await user.tab();
    expect(await screen.findByText(/Não foi possível consultar o CEP/)).toBeInTheDocument();
    expect(screen.getByLabelText('Logradouro')).toBeEnabled();
  });
  it('consultas fora de ordem: só a resposta do último CEP é aplicada', async () => {
    let resolverA!: (v: unknown) => void;
    buscarCep
      .mockImplementationOnce(() => new Promise((r) => { resolverA = r; }))
      .mockResolvedValueOnce({ logradouro: 'Rua B', bairro: 'Bairro B', municipio: 'Olinda', uf: 'PE', municipio_ibge: '2609600' });
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    const cep = screen.getByLabelText('CEP');
    await user.type(cep, '11111111');
    await user.tab();
    await user.clear(cep);
    await user.type(cep, '22222222');
    await user.tab();
    await waitFor(() => expect(gravados()).toContainEqual({ municipio: 'Olinda' }));
    resolverA({ logradouro: 'Rua A', bairro: 'Bairro A', municipio: 'Recife', uf: 'PE', municipio_ibge: '2611606' });
    await new Promise((r) => setTimeout(r, 0));
    expect(gravados()).not.toContainEqual({ municipio: 'Recife' });
  });
  it('falha ao gravar o CEP aparece no campo', async () => {
    buscarCep.mockResolvedValue(null);
    salvarEmpresa.mockRejectedValueOnce(new Error('falha de rede ao salvar'));
    const user = userEvent.setup();
    renderSecao({ empresa: EMPRESA_BASE });
    await user.type(screen.getByLabelText('CEP'), '51021530');
    await user.tab();
    expect(await screen.findByText(/falha de rede ao salvar/)).toBeInTheDocument();
  });
});
