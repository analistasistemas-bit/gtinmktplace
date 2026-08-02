// Task 5, fix round 1, Achado 3: o ciclo de vida de `chaveCadastro` é a propriedade que
// sustenta a idempotência das Tasks 4/4b (guard de divergência, comparação de custo). Se
// alguém trocar a chave a cada submit (ex.: "limpar" o formulário no clique), nenhum teste
// da edge acusa — só um teste deste diálogo protege essa invariante.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCadastroProduto } from '../dialog-cadastro-produto';
import { ProdutoJaExisteError, CadastroResultadoAmbiguoError } from '@/lib/produtos-saldo';

const cadastrarProdutoMock = vi.fn().mockRejectedValue(new Error('falhou'));
// Hoisted (não `vi.fn()` inline na factory) para o teste do lote de fotos poder inspecionar
// COM QUE argumentos `uploadFotoProduto` foi chamado — é isso que prova o casamento posicional
// e o fix de `loteId` (ver comentário em `subirFoto`, dialog-cadastro-produto.tsx).
const uploadFotoProdutoMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/produtos-saldo', () => ({
  cadastrarProduto: (...args: unknown[]) => cadastrarProdutoMock(...args),
  uploadFotoProduto: (...args: unknown[]) => uploadFotoProdutoMock(...args),
  ProdutoJaExisteError: class ProdutoJaExisteError extends Error {
    constructor(mensagem: string, readonly familiaId: string, readonly loteId: string) {
      super(mensagem);
    }
  },
  // Fallback ambíguo (rede, ou erro que não é 409/validação) — ver cadastrarProduto em
  // produtos-saldo.ts. `class extends Error` basta: o dialog só faz `instanceof`.
  CadastroResultadoAmbiguoError: class CadastroResultadoAmbiguoError extends Error {},
}));

// subirFoto (dialog-cadastro-produto.tsx) chama estes três diretamente antes de delegar a
// uploadFotoProduto — sem mocká-los o teste do lote bateria na rede real.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: vi.fn() },
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

function renderDialogCom(props: Partial<{ onFechar: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DialogCadastroProduto aberto onFechar={props.onFechar ?? (() => {})} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDialog() {
  return renderDialogCom();
}

// Controla `aberto` de fora (fechar/reabrir sem desmontar `DialogCadastroProduto`) — é o que
// dispara o useEffect de reset que decide se `chaveCadastro` regenera ou não.
function renderDialogControlado() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ aberto }: { aberto: boolean }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DialogCadastroProduto aberto={aberto} onFechar={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  const utils = render(<Wrapper aberto />);
  return {
    fechar: () => utils.rerender(<Wrapper aberto={false} />),
    reabrir: () => utils.rerender(<Wrapper aberto />),
  };
}

async function preencherEEnviar(user: ReturnType<typeof userEvent.setup>, nome: string) {
  await user.type(screen.getByLabelText('Nome'), nome);
  await user.click(screen.getByRole('radio', { name: 'Nacional' }));
  await user.type(screen.getByLabelText('Preço da variação 1'), '10');
  await user.click(screen.getByRole('button', { name: 'Cadastrar' }));
}

describe('DialogCadastroProduto — ciclo de vida da chaveCadastro', () => {
  // afterEach (não beforeEach): limpar ANTES do próximo teste começar, depois que as
  // promises do teste atual já settled — mockClear() num beforeEach corrompe o rastreamento
  // interno do Vitest de rejeicoes tratadas quando a promise ainda esta em voo.
  afterEach(() => cadastrarProdutoMock.mockClear());

  it('submit que falha e resubmit reenviam a MESMA chaveCadastro', async () => {
    const user = userEvent.setup();
    renderDialog();

    // DialogContent (Radix) faz portal pro document.body — fora do container do render, por
    // isso a busca é em `document`, não em `container`.
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    const precoInput = screen.getByLabelText('Preço da variação 1');
    await user.type(precoInput, '10');

    const botao = screen.getByRole('button', { name: 'Cadastrar' });
    await user.click(botao);
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));

    await user.click(botao);
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(2));

    const chave1 = cadastrarProdutoMock.mock.calls[0][0].chaveCadastro;
    const chave2 = cadastrarProdutoMock.mock.calls[1][0].chaveCadastro;
    expect(chave1).toBeTruthy();
    expect(chave2).toBe(chave1);
  });

  // Achado do fix: resultado AMBÍGUO (rede caiu, ou erro que não é 409/validação) não prova
  // que a edge não gravou. Fechar e reabrir o diálogo regenerando a chave faria o próximo
  // submit ser tratado como um cadastro NOVO pela idempotência da edge — duplicando o produto.
  it('resultado ambíguo: fechar e reabrir preserva a MESMA chaveCadastro (retry idempotente)', async () => {
    cadastrarProdutoMock.mockRejectedValueOnce(new CadastroResultadoAmbiguoError('falha de rede'));
    const user = userEvent.setup();
    const { fechar, reabrir } = renderDialogControlado();

    await preencherEEnviar(user, 'Produto Teste');
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    const chave1 = cadastrarProdutoMock.mock.calls[0][0].chaveCadastro;

    fechar();
    reabrir();

    await preencherEEnviar(user, 'Produto Teste');
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(2));
    const chave2 = cadastrarProdutoMock.mock.calls[1][0].chaveCadastro;

    expect(chave1).toBeTruthy();
    expect(chave2).toBe(chave1);
  });

  // Regressão: um 409 CONHECIDO (a edge confirmou que já existe — caso resolvido, não
  // ambíguo) continua liberando a chave pra regenerar ao fechar, como já fazia antes do fix.
  it('409 conhecido: fechar e reabrir troca a chaveCadastro normalmente', async () => {
    cadastrarProdutoMock.mockRejectedValueOnce(
      new ProdutoJaExisteError('Produto já existe.', 'fam-1', 'lote-1'),
    );
    const user = userEvent.setup();
    const { fechar, reabrir } = renderDialogControlado();

    await preencherEEnviar(user, 'Produto Teste');
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    const chave1 = cadastrarProdutoMock.mock.calls[0][0].chaveCadastro;

    fechar();
    reabrir();

    await preencherEEnviar(user, 'Produto Teste');
    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(2));
    const chave2 = cadastrarProdutoMock.mock.calls[1][0].chaveCadastro;

    expect(chave1).toBeTruthy();
    expect(chave2).not.toBe(chave1);
  });
});

describe('DialogCadastroProduto — formulário em cards', () => {
  // jsdom não implementa URL.createObjectURL/revokeObjectURL — mock devolve a URL a partir do
  // nome do arquivo, o que permite o teste abaixo confirmar qual File está em qual variação.
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((f: File) => `blob:${f.name}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    // cleanup() explícito ANTES de remover o mock: o cleanup automático do RTL roda num
    // afterEach de escopo mais externo (registrado no import do módulo), que só executa
    // DEPOIS deste afterEach local — sem isto, o unmount dispara o cleanup do `useEffect`
    // (revokeObjectURL) já sem o mock, e o teste quebra por um motivo que não é o dele.
    cleanup();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('remover a variação do meio preserva os dados das outras', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));

    await user.type(screen.getByLabelText('Cor / nome da variação 1'), 'azul');
    await user.type(screen.getByLabelText('Cor / nome da variação 2'), 'verde');
    await user.type(screen.getByLabelText('Cor / nome da variação 3'), 'preto');

    await user.click(screen.getByRole('button', { name: 'Remover variação 2' }));

    expect(screen.getByLabelText('Cor / nome da variação 1')).toHaveValue('azul');
    expect(screen.getByLabelText('Cor / nome da variação 2')).toHaveValue('preto');
  });

  // Achado 4 (revisão final): a mensagem de erro não pode aparecer no formulário virgem — a
  // spec (§5.4) exige que ela só apareça depois do primeiro blur do campo (ou de uma tentativa
  // de salvar). O teste anterior documentava o comportamento errado como intencional.
  it('preço vazio: sem mensagem no formulário virgem; aparece só depois do blur', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    expect(screen.queryByText('Preço é obrigatório e deve ser maior que zero.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();

    await user.click(screen.getByLabelText('Preço da variação 1'));
    await user.tab();
    expect(screen.getByText('Preço é obrigatório e deve ser maior que zero.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });

  it('estoque fracionário é recusado inline', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Estoque inicial da variação 1'), '2,5');
    await user.tab();
    expect(screen.getByText('Estoque inicial deve ser um número inteiro.')).toBeInTheDocument();
  });

  it('texto não numérico no custo é recusado em vez de virar campo vazio', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Custo da variação 1'), 'abc');
    await user.tab();
    expect(screen.getByText('Valor inválido.')).toBeInTheDocument();
  });

  it('custo inválido em qualquer linha trava o botão, não só preço', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeEnabled();

    await user.type(screen.getByLabelText('Custo da variação 1'), 'abc');
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });

  it('remover a variação do meio preserva o arquivo de foto das outras (input não-controlado)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));

    const fotoAzul = new File(['a'], 'azul.png', { type: 'image/png' });
    const fotoPreto = new File(['p'], 'preto.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Foto da variação 1'), fotoAzul);
    await user.upload(screen.getByLabelText('Foto da variação 3'), fotoPreto);

    await user.click(screen.getByRole('button', { name: 'Remover variação 2' }));

    // Assere no `.files` do próprio <input type="file"> — DOM não-controlado, é o que o
    // navegador guarda no elemento, não o que o state/preview React mostra. Sob key={i}
    // (bug antigo), o React reaproveitaria o NÓ DOM da posição 2: o preview (derivado do
    // state) mostraria a foto certa mesmo assim, mas o `.files` do input real ficaria
    // vazio/errado, porque o React nunca escreve de volta em `<input type="file">`
    // (é uncontrolled). Testar via preview/state não captura esse desalinhamento.
    const inputVar1 = screen.getByLabelText('Foto da variação 1') as HTMLInputElement;
    const inputVar2 = screen.getByLabelText('Foto da variação 2') as HTMLInputElement;
    expect(inputVar1.files?.[0]?.name).toBe('azul.png');
    expect(inputVar2.files?.[0]?.name).toBe('preto.png');
  });
});

describe('DialogCadastroProduto — fotos e travas', () => {
  // uploadFotoProdutoMock é compartilhado com o describe seguinte (lote de fotos), que conta
  // chamadas absolutas — sem isto, os testes daqui vazam contagem para lá.
  afterEach(() => {
    uploadFotoProdutoMock.mockClear();
  });

  // D6: pendência de IA ou de estoque NÃO pode esconder o upload — a foto é o que o operador
  // veio fazer, e ele fica sem nenhum caminho para enviá-la.
  it('mostra os campos de foto mesmo com filaOk false', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: false, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000005' }],
    });
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText(/não foi enfileirado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Capa')).toBeInTheDocument();
  });

  // Achado 3 (revisão final): `enviandoFotos` volta a `null` mesmo quando o lote termina com
  // falha — sem a trava, "Fechar" descartava os `File` pendentes sem nenhum aviso.
  it('fechar com foto pendente de reenvio exige confirmação antes de descartar', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000005' }],
    });
    uploadFotoProdutoMock.mockRejectedValueOnce(new Error('falhou'));
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialogCom({ onFechar });
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.upload(screen.getByLabelText('Capa'), new File(['c'], 'capa.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText(/Falha ao enviar a foto de/)).toBeInTheDocument();

    // "Fechar" não fecha direto: abre a confirmação, sem descartar nada ainda.
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByText('Fechar sem reenviar as fotos que falharam?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fechar mesmo assim' }));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  // A mesma trava vale para "Ir para a Revisão": ele também chama `onFechar` por baixo (para
  // fechar o diálogo antes de navegar), então também descartaria o `File` pendente sem avisar.
  it('"Ir para a Revisão" com foto pendente também exige confirmação, e navega ao confirmar', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000005' }],
    });
    uploadFotoProdutoMock.mockRejectedValueOnce(new Error('falhou'));
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialogCom({ onFechar });
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.upload(screen.getByLabelText('Capa'), new File(['c'], 'capa.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText(/Falha ao enviar a foto de/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ir para a Revisão' }));
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByText('Fechar sem reenviar as fotos que falharam?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fechar mesmo assim' }));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('não fecha enquanto o cadastro está em voo', async () => {
    let resolver: (v: unknown) => void = () => {};
    cadastrarProdutoMock.mockImplementationOnce(() => new Promise((r) => { resolver = r; }));
    const onFechar = vi.fn();
    const user = userEvent.setup();
    renderDialogCom({ onFechar });
    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await user.keyboard('{Escape}');
    expect(onFechar).not.toHaveBeenCalled();
    resolver({ loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [], variacoes: [] });
  });
});

describe('DialogCadastroProduto — lote de fotos (casamento posicional)', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((f: File) => `blob:${f.name}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    uploadFotoProdutoMock.mockClear();
  });

  // Cobre a cadeia inteira que a task descreve como de maior risco: fotos escolhidas na
  // etapa 1 (capa + por variação), uma linha removida do MEIO antes do submit (reindexa
  // `linhas`), e o lote sobe cada arquivo pro id certo — usando o `loteId` que veio da
  // RESPOSTA do cadastro, não de `resultado` (que ainda está `null` no momento da chamada).
  it('sobe capa e fotos de variação casando por posição, mesmo após remover a linha do meio', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000005' }, { id: 'v2', codigo: '00000006' }],
    });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));

    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.type(screen.getByLabelText('Preço da variação 2'), '10');
    await user.type(screen.getByLabelText('Preço da variação 3'), '10');

    const capaFile = new File(['c'], 'capa.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Capa'), capaFile);

    const fotoAzul = new File(['a'], 'azul.png', { type: 'image/png' });
    const fotoPreto = new File(['p'], 'preto.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Foto da variação 1'), fotoAzul);
    await user.upload(screen.getByLabelText('Foto da variação 3'), fotoPreto);

    // Remove a variação do meio DEPOIS de escolher os arquivos — é o cenário que quebraria
    // sob `key={indice}` (bug antigo) ou sob qualquer casamento que não seja por posição.
    await user.click(screen.getByRole('button', { name: 'Remover variação 2' }));

    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(uploadFotoProdutoMock).toHaveBeenCalledTimes(3));

    expect(uploadFotoProdutoMock).toHaveBeenCalledWith(
      'owner-1', 'l1', capaFile, { tipo: 'capa', familiaId: 'f1' },
    );
    // linhas[0] (azul) ↔ variacoes[0] (v1); linhas[1] (preto, era a 3ª antes da remoção) ↔
    // variacoes[1] (v2) — prova que a remoção reindexou `linhas` e o casamento seguiu junto.
    expect(uploadFotoProdutoMock).toHaveBeenCalledWith(
      'owner-1', 'l1', fotoAzul, { tipo: 'variacao', variacaoId: 'v1' },
    );
    expect(uploadFotoProdutoMock).toHaveBeenCalledWith(
      'owner-1', 'l1', fotoPreto, { tipo: 'variacao', variacaoId: 'v2' },
    );
  });

  // Achado real: retry idempotente pode devolver o cadastro ORIGINAL da edge, com uma
  // contagem de variações diferente do formulário atual (linhas editadas entre tentativas).
  // Casar por índice nesse caso arriscaria gravar a foto no SKU errado — o fix trava o
  // casamento de variação inteiro e avisa o operador em vez de arriscar.
  it('contagem de variações divergente: não casa foto nenhuma por índice, e avisa o operador', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000005' }], // edge devolveu só 1 variação
    });
    const user = userEvent.setup();
    renderDialog();

    // Formulário atual tem 2 linhas — diverge do retorno da edge (1 variação).
    await user.click(screen.getByRole('button', { name: /Adicionar variação/ }));

    await user.type(screen.getByLabelText('Nome'), 'Produto Teste');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.type(screen.getByLabelText('Preço da variação 1'), '10');
    await user.type(screen.getByLabelText('Preço da variação 2'), '10');

    const fotoAzul = new File(['a'], 'azul.png', { type: 'image/png' });
    const fotoPreto = new File(['p'], 'preto.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Foto da variação 1'), fotoAzul);
    await user.upload(screen.getByLabelText('Foto da variação 2'), fotoPreto);

    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    // O operador é avisado.
    expect(await screen.findByText(/contagem divergente/)).toBeInTheDocument();

    // Nenhuma foto de variação foi enviada — só a checagem de que uploadFotoProdutoMock
    // nunca foi chamado com um alvo `tipo: 'variacao'` prova isso (não há capa neste teste,
    // então "nunca chamado" já bastaria, mas ser explícito documenta a intenção do teste).
    expect(uploadFotoProdutoMock).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      expect.objectContaining({ tipo: 'variacao' }),
    );
    expect(uploadFotoProdutoMock).not.toHaveBeenCalled();
  });
});
