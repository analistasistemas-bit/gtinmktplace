// ADR-0129 (Task 6): dialog "Adicionar variação" — versão simplificada do cadastro
// (dialog-cadastro-produto.tsx) para clonar uma família publicada + N cores novas num lote de
// UPDATE. Cobre os critérios de aceite 3 (sem foto não salva) e 5 (lote em voo bloqueia), mais
// o payload que a edge `adicionar-variacoes-familia` espera.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DialogAdicionarVariacao } from '../dialog-adicionar-variacao';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';
import type { FamiliaStatusRow } from '@/lib/estoque-update-status';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const invokeMock = vi.fn();
const familiaPrefillDataMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (table: string) => {
      if (table !== 'familias') throw new Error(`tabela inesperada no mock: ${table}`);
      // Espelha a query real (select→eq→order→limit) só o suficiente para o dialog: sempre
      // resolve com o array que o teste armou em familiaPrefillDataMock.
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: familiaPrefillDataMock(), error: null }),
            }),
          }),
        }),
      };
    },
  },
}));

vi.mock('@/stores/support-store', () => ({
  effectiveOrgId: () => 'org-1',
  canWrite: () => true,
  useSupportStore: { getState: () => ({ context: null }) },
}));
vi.mock('@/hooks/useUploadLote', () => ({
  storageOwnerForUpload: () => 'owner-1',
}));
// buildStoragePath fica REAL (função pura) — só uploadFile é mockado (não bate rede real);
// devolve o próprio path recebido, o que permite o teste de payload conferir o formato completo.
vi.mock('@/lib/storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage')>()),
  uploadFile: (_bucket: string, path: string) => Promise.resolve(path),
}));

const famRowsMock = vi.fn<() => FamiliaStatusRow[]>(() => []);
vi.mock('@/lib/estoque-update-status', async (orig) => ({
  ...(await orig<typeof import('@/lib/estoque-update-status')>()),
  fetchFamiliasNaoPublicadas: () => Promise.resolve(famRowsMock()),
}));

const produto: ProdutoEstoqueResumo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: null,
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: 'MLB123', criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20, qtdSkus: 1, skuUnico: '00000005',
  gtins: ['4005800241901'], codigos: ['00000005'], cores: ['incolor'], nomes: [],
};

function renderDialog(onFechar = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DialogAdicionarVariacao produto={produto} aberto onFechar={onFechar} />
    </QueryClientProvider>,
  );
  return onFechar;
}

async function preencherLinha(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  { codigo = '00000006', comFoto = true, estoqueInicial = '5' }:
    { codigo?: string; comFoto?: boolean; estoqueInicial?: string } = {},
) {
  if (codigo) await user.type(screen.getByLabelText(`Código (SKU) da variação ${n}`), codigo);
  await user.type(screen.getByLabelText(`Cor / nome da variação ${n}`), 'Azul');
  await user.type(screen.getByLabelText(`Preço mínimo (líquido) da variação ${n}`), '10');
  if (estoqueInicial) {
    await user.type(screen.getByLabelText(`Estoque inicial da variação ${n}`), estoqueInicial);
  }
  if (comFoto) {
    await user.upload(
      screen.getByLabelText(`Foto da variação ${n}`),
      new File(['a'], `azul-${n}.png`, { type: 'image/png' }),
    );
  }
}

beforeEach(() => {
  invokeMock.mockReset();
  familiaPrefillDataMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.error).mockReset();
  famRowsMock.mockReset();
  famRowsMock.mockReturnValue([]);
  // Família canônica com uma irmã de referência (peso/dimensões pro prefill, D-6).
  familiaPrefillDataMock.mockReturnValue([{
    id: 'fam-canonica-1',
    variacoes: [{ codigo: '00000005', peso_gramas: 100, altura_cm: 5, largura_cm: 5, comprimento_cm: 5 }],
  }]);
  // jsdom não implementa URL.createObjectURL/revokeObjectURL — CampoFoto chama isso sempre que
  // uma linha tem `arquivo` (mesmo mock de dialog-cadastro-produto.test.tsx).
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((f: File) => `blob:${f.name}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  // cleanup() explícito ANTES de remover o mock — ver dialog-cadastro-produto.test.tsx.
  cleanup();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

const BOTAO_SALVAR = () => screen.getByRole('button', { name: 'Salvar' });

describe('DialogAdicionarVariacao', () => {
  it('botão travado sem foto em alguma linha', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await preencherLinha(user, 1, { comFoto: false });
    expect(BOTAO_SALVAR()).toBeDisabled();
  });

  it('botão travado com código duplicado entre linhas', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await preencherLinha(user, 1, { codigo: '00000006' });
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));
    await preencherLinha(user, 2, { codigo: '00000006' });
    expect(BOTAO_SALVAR()).toBeDisabled();
  });

  // '123' e '00000123' são o MESMO código depois de normalizarCodigo8 (edge) — o form precisa
  // barrar essa dupla como se fossem idênticos, senão os dois passam e a edge (ou o banco)
  // rejeita depois de já ter subido as fotos.
  it('botão travado com códigos que colidem só depois do padStart (\'123\' vs \'00000123\')', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await preencherLinha(user, 1, { codigo: '123' });
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));
    await preencherLinha(user, 2, { codigo: '00000123' });
    expect(BOTAO_SALVAR()).toBeDisabled();
  });

  it('botão travado com código inválido (letras)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await preencherLinha(user, 1, { codigo: 'abc' });
    expect(BOTAO_SALVAR()).toBeDisabled();
  });

  it('estoque inicial 0 trava e mostra erro', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await preencherLinha(user, 1, { estoqueInicial: '0' });
    expect(BOTAO_SALVAR()).toBeDisabled();
    // Mensagem aparece assim que o campo é preenchido (sem gate por `tentouSalvar`): o botão
    // já está desabilitado neste estado, e um clique nele nunca dispara o handler de submit.
    expect(screen.getByText('Estoque inicial deve ser maior que zero.')).toBeInTheDocument();
  });

  it('família em voo mostra banner e trava submit', async () => {
    famRowsMock.mockReturnValue([
      { codigo_pai: '00000004', status: 'processando', operacao: 'UPDATE', criado_em: '2026-08-19T10:00:00Z' },
    ]);
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await screen.findByText(/Já existe uma atualização em andamento/);
    await preencherLinha(user, 1);
    expect(BOTAO_SALVAR()).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('submit sobe fotos e chama a edge com payload correto', async () => {
    invokeMock.mockResolvedValue({
      data: { loteId: 'lote-1', familiaId: 'fam-nova-1', publicacaoOk: true, falhasEstoque: [] },
      error: null,
    });
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialog(onFechar);
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await preencherLinha(user, 1, { codigo: '00000006' });
    await waitFor(() => expect(BOTAO_SALVAR()).not.toBeDisabled());

    await user.click(BOTAO_SALVAR());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    const [nome, opts] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(nome).toBe('adicionar-variacoes-familia');
    expect(opts.body.familia_id).toBe('fam-canonica-1');
    expect(typeof opts.body.chave).toBe('string');
    const variacoes = opts.body.variacoes as Array<Record<string, unknown>>;
    expect(variacoes).toHaveLength(1);
    expect(variacoes[0]).toMatchObject({
      codigo: '00000006', nome: 'Azul', preco: 10, estoqueInicial: 5,
    });
    expect(variacoes[0]!.imagemPath).toMatch(/^owner-1\/.+\/00000006-azul-1\.png$/);

    await waitFor(() => expect(onFechar).toHaveBeenCalled());
  });

  // Extensão do D-6 (2026-08-21): custo e preço mínimo raramente mudam entre cores do mesmo
  // produto — pré-preencher da irmã evita o admin ter que ir consultar a outra variação antes
  // de digitar. Igual a peso/dimensões, continua editável.
  it('pré-preenche custo e preço mínimo da variação irmã', async () => {
    familiaPrefillDataMock.mockReturnValue([{
      id: 'fam-canonica-1',
      variacoes: [{
        codigo: '00000005', peso_gramas: 100, altura_cm: 5, largura_cm: 5, comprimento_cm: 5,
        custo: 12.5, preco: 29.9,
      }],
    }]);
    invokeMock.mockResolvedValue({
      data: { loteId: 'lote-1', familiaId: 'fam-nova-1', publicacaoOk: true, falhasEstoque: [] },
      error: null,
    });
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await waitFor(() => expect(
      screen.getByLabelText('Preço mínimo (líquido) da variação 1'),
    ).toHaveValue('29.9'));
    expect(screen.getByLabelText('Custo da variação 1')).toHaveValue('12.5');

    // Não digita preço/custo — só o resto — e confirma que o valor pré-preenchido vai no payload.
    await user.type(screen.getByLabelText('Código (SKU) da variação 1'), '00000006');
    await user.type(screen.getByLabelText('Cor / nome da variação 1'), 'Azul');
    await user.type(screen.getByLabelText('Estoque inicial da variação 1'), '5');
    await user.upload(
      screen.getByLabelText('Foto da variação 1'),
      new File(['a'], 'azul.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(BOTAO_SALVAR()).not.toBeDisabled());
    await user.click(BOTAO_SALVAR());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    const [, opts] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    const variacoes = opts.body.variacoes as Array<Record<string, unknown>>;
    expect(variacoes[0]).toMatchObject({ custo: 12.5, preco: 29.9 });
  });

  // "200 não prova canal atualizado" — mesmo racional do push de estoque no ML
  // (reference_estoque_push_ml): publicacaoOk=false e falhasEstoque não podem virar sucesso
  // silencioso só porque a chamada HTTP não deu erro.
  it('publicacaoOk=false e falhasEstoque avisam por toast, mas ainda fecham o diálogo', async () => {
    invokeMock.mockResolvedValue({
      data: {
        loteId: 'lote-1', familiaId: 'fam-nova-1', publicacaoOk: false,
        falhasEstoque: ['00000006: falha no ledger'],
      },
      error: null,
    });
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialog(onFechar);
    await waitFor(() => expect(familiaPrefillDataMock).toHaveBeenCalled());
    await preencherLinha(user, 1, { codigo: '00000006' });
    await waitFor(() => expect(BOTAO_SALVAR()).not.toBeDisabled());

    await user.click(BOTAO_SALVAR());

    await waitFor(() => expect(onFechar).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Variações enviadas'));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('publicação não foi disparada'));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('00000006: falha no ledger'));
  });
});
