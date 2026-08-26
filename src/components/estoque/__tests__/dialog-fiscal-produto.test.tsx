// Task 13 (ADR-0135 D-9) — dialog de edição fiscal em fila. Cobre: carregar valores existentes,
// Salvar no shape da Task 9, erro 400 renderizado inline, "Salvar e próximo" avançando a fila, e
// o fix do ruling do controller: família legada com `unidade` fora do vocabulário ganha um select
// extra (T13) porque o payload fiscal nunca editava unidade (travaria a fila sem saída).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogFiscalProduto } from '../dialog-fiscal-produto';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const FAMILIA_MOCK = {
  nome_pai: 'Agulha de Crochê', origem: 'nacional', unidade: 'UN',
  ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102',
};

function mockFamilia(data: Record<string, unknown> | null = FAMILIA_MOCK) {
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data, error: null }),
      }),
    }),
  });
}

function mockSugestaoNcm(ncm: string | null = null) {
  (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockImplementation((fn: string) => {
    if (fn === 'sugerir-ncm') return Promise.resolve({ data: { ncm, justificativa: 'ok' }, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  mockFamilia();
  mockSugestaoNcm(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(props: Partial<Parameters<typeof DialogFiscalProduto>[0]> = {}) {
  return render(
    <DialogFiscalProduto
      familiaId="fam-1"
      fila={['fam-1']}
      onFechar={props.onFechar ?? vi.fn()}
      onAvancar={props.onAvancar ?? vi.fn()}
      onSalvo={props.onSalvo ?? vi.fn()}
      {...props}
    />,
  );
}

describe('DialogFiscalProduto — carrega valores existentes', () => {
  it('popula NCM, origem fiscal e CSOSN com os valores já gravados', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    expect(screen.getByLabelText(/Origem fiscal/i)).toHaveValue('0');
    expect(screen.getByLabelText('CSOSN')).toHaveValue('102');
  });

  it('busca a sugestão de NCM ao abrir, com o familiaId', async () => {
    renderDialog();
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'sugerir-ncm', { body: { familiaId: 'fam-1' } },
    ));
  });

  it('familiaId null não renderiza conteúdo carregado (dialog fechado)', () => {
    renderDialog({ familiaId: null });
    expect(screen.queryByLabelText('NCM')).not.toBeInTheDocument();
  });
});

describe('DialogFiscalProduto — Salvar', () => {
  it('chama atualizar-fiscal-familia com o shape da Task 9 e fecha ao suceder', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockImplementation((fn: string) => {
      if (fn === 'sugerir-ncm') return Promise.resolve({ data: { ncm: null, justificativa: '' }, error: null });
      if (fn === 'atualizar-fiscal-familia') return Promise.resolve({ data: { ok: true, pushEnfileirado: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const onFechar = vi.fn();
    const onSalvo = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onFechar, onSalvo });

    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'atualizar-fiscal-familia',
      {
        body: {
          familiaId: 'fam-1',
          fiscal: { ncm: '39269090', cest: null, origemNfe: 0, fci: null, exTipi: null, tributacaoIcms: '102' },
        },
      },
    ));
    expect(toastSuccess).toHaveBeenCalledWith('✓ Fiscal salvo');
    expect(onSalvo).toHaveBeenCalled();
    expect(onFechar).toHaveBeenCalled();
  });

  it('erro 400 da edge renderiza as mensagens de erro', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockImplementation((fn: string) => {
      if (fn === 'sugerir-ncm') return Promise.resolve({ data: { ncm: null, justificativa: '' }, error: null });
      if (fn === 'atualizar-fiscal-familia') {
        const erro = new Error('edge falhou') as Error & { context: unknown };
        erro.context = {
          status: 400,
          json: async () => ({ erros: [{ campo: 'fiscal', mensagem: 'ncm (8 dígitos)' }] }),
        };
        return Promise.resolve({ data: null, error: erro });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onFechar });

    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('ncm (8 dígitos)')).toBeInTheDocument();
    // Erro não fecha o dialog — o operador precisa corrigir e tentar de novo.
    expect(onFechar).not.toHaveBeenCalled();
  });
});

describe('DialogFiscalProduto — Salvar e próximo (fila)', () => {
  it('só aparece quando fila.length > 1', async () => {
    renderDialog({ fila: ['fam-1'] });
    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    expect(screen.queryByRole('button', { name: 'Salvar e próximo' })).not.toBeInTheDocument();
  });

  it('salva e chama onAvancar com o próximo id da fila', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockImplementation((fn: string) => {
      if (fn === 'sugerir-ncm') return Promise.resolve({ data: { ncm: null, justificativa: '' }, error: null });
      if (fn === 'atualizar-fiscal-familia') return Promise.resolve({ data: { ok: true, pushEnfileirado: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const onAvancar = vi.fn();
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialog({ fila: ['fam-1', 'fam-2'], onAvancar, onFechar });

    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    await user.click(screen.getByRole('button', { name: 'Salvar e próximo' }));

    await waitFor(() => expect(onAvancar).toHaveBeenCalledWith('fam-2'));
    expect(onFechar).not.toHaveBeenCalled();
  });
});

describe('DialogFiscalProduto — unidade fora do vocabulário (ruling do controller)', () => {
  it('família com unidade legada inválida mostra o select de unidade, sem pré-seleção', async () => {
    mockFamilia({ ...FAMILIA_MOCK, unidade: 'PACOTE' });
    renderDialog();
    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    expect(screen.getByLabelText(/Unidade/i)).toHaveValue('');
  });

  it('família com unidade válida NÃO mostra o select de unidade', async () => {
    renderDialog(); // FAMILIA_MOCK.unidade = 'UN'
    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    expect(screen.queryByLabelText(/Unidade/i)).not.toBeInTheDocument();
  });

  it('Salvar fica travado até escolher a unidade, e o payload leva a unidade escolhida', async () => {
    mockFamilia({ ...FAMILIA_MOCK, unidade: 'PACOTE' });
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockImplementation((fn: string) => {
      if (fn === 'sugerir-ncm') return Promise.resolve({ data: { ncm: null, justificativa: '' }, error: null });
      if (fn === 'atualizar-fiscal-familia') return Promise.resolve({ data: { ok: true, pushEnfileirado: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const user = userEvent.setup();
    renderDialog();

    await waitFor(() => expect(screen.getByLabelText('NCM')).toHaveValue('39269090'));
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/Unidade/i), 'PC');
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'atualizar-fiscal-familia',
      {
        body: {
          familiaId: 'fam-1',
          fiscal: {
            ncm: '39269090', cest: null, origemNfe: 0, fci: null, exTipi: null, tributacaoIcms: '102',
            unidade: 'PC',
          },
        },
      },
    ));
  });
});
