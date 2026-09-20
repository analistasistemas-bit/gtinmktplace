import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCadastroGrade } from '../dialog-cadastro-grade';

const cadastrarProdutoMock = vi.fn();
vi.mock('@/lib/produtos-saldo', () => ({
  cadastrarProduto: (...a: unknown[]) => cadastrarProdutoMock(...a),
  uploadFotoProduto: vi.fn().mockResolvedValue(undefined),
  ProdutoJaExisteError: class extends Error {},
  CadastroResultadoAmbiguoError: class extends Error {},
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));
vi.mock('@/stores/support-store', () => ({
  effectiveOrgId: () => 'org-1', canWrite: () => true,
  useSupportStore: { getState: () => ({ context: null }) },
}));
vi.mock('@/hooks/useUploadLote', () => ({ storageOwnerForUpload: () => 'owner-1' }));
const modulosMock = vi.fn(() => ({ data: [] as string[], isLoading: false }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulosMock() }));
const tiposProdutoMock = vi.fn(() => ({ data: ['roupa'] as string[] }));
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({
  useTiposProdutoHabilitados: () => tiposProdutoMock(),
}));

function renderGrade(onFechar = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DialogCadastroGrade aberto onFechar={onFechar} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); tiposProdutoMock.mockReturnValue({ data: ['roupa'] }); });

describe('DialogCadastroGrade — passo 0 (escolha do tipo)', () => {
  it('org com 1 tipo pula o passo 0 e já mostra o cabeçalho', () => {
    renderGrade();
    expect(screen.queryByRole('button', { name: 'Calçado' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  // O dialog fica MONTADO permanentemente em Estoque.tsx e `useTiposProdutoHabilitados` é
  // react-query: o primeiro render acontece com `data === undefined`. Um `useState` inicializado
  // de `tipos[0]` congelaria `null` e a org de 1 tipo ficaria num passo 0 vazio pra sempre. Os
  // outros testes deste arquivo NÃO pegam isso — o mock devolve dado síncrono (mesmo padrão do
  // incidente ADR-0129, "mock não basta"). Este é o único que reproduz a query chegando depois.
  it('tipo que chega DEPOIS do primeiro render ainda pula o passo 0', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // FUNÇÃO, não constante: `rerender` com o MESMO objeto de elemento aciona o bail-out do
    // React e o componente nem reexecuta — o teste passaria sem provar nada.
    const arvore = () => (
      <QueryClientProvider client={qc}>
        <MemoryRouter><DialogCadastroGrade aberto onFechar={() => {}} /></MemoryRouter>
      </QueryClientProvider>
    );
    tiposProdutoMock.mockReturnValue({ data: undefined as unknown as string[] });
    const { rerender } = render(arvore());
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
    // A query resolve. Com o tipo DERIVADO o passo 0 some sozinho; com `useState(tipos[0])`
    // o state continua `null` e a tela fica presa num passo 0 sem botão nenhum.
    tiposProdutoMock.mockReturnValue({ data: ['roupa'] });
    rerender(arvore());
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('org com os 2 tipos escolhe entre Roupa e Calçado antes de tudo', async () => {
    tiposProdutoMock.mockReturnValue({ data: ['roupa', 'calcado'] });
    const user = userEvent.setup();
    renderGrade();
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Calçado' }));
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '42' })).toBeInTheDocument();
  });

  it('trocar o tipo com linhas já geradas pede confirmação e reseta a seleção', async () => {
    tiposProdutoMock.mockReturnValue({ data: ['roupa', 'calcado'] });
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('button', { name: 'Roupa' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.type(screen.getByLabelText('GTIN de Preto · P'), '789');

    await user.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Trocar mesmo assim/i }));
    await user.click(screen.getByRole('button', { name: 'Calçado' }));
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
  });
});

describe('DialogCadastroGrade — passo 2 (seleção) reconcilia a grade', () => {
  it('marcar cor e tamanho gera as linhas na hora, sem botão "Gerar"', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    // `/·/` sozinho NÃO serve: o título do dialog é `Cadastrar … · etapa N de M` (mesmo padrão
    // de `dialog-cadastro-produto.tsx:447-450`), então o seletor casaria com o título e o teste
    // falharia por um motivo que não tem nada a ver com a grade. Ancorar na cor real.
    expect(screen.queryByText(/Preto · /)).not.toBeInTheDocument(); // só cor ainda não gera linha
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    expect(screen.getByText('Preto · P')).toBeInTheDocument();
    expect(screen.getByText('Preto · M')).toBeInTheDocument();
  });

  it('marcar mais uma cor ACRESCENTA linhas sem apagar o que já foi digitado', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.type(screen.getByLabelText('GTIN de Preto · P'), '7891234');
    await user.click(screen.getByRole('checkbox', { name: 'Branco' }));
    expect(screen.getByLabelText('GTIN de Preto · P')).toHaveValue('7891234');
    expect(screen.getByText('Branco · P')).toBeInTheDocument();
  });

  it('desmarcar cor de linha AINDA VAZIA remove direto, sem confirmação', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
  });

  it('desmarcar cor com dado digitado pede confirmação antes de apagar', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.type(screen.getByLabelText('Estoque inicial de Preto · P'), '3');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Preto · P')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remover mesmo assim/i }));
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
  });

  it('remover linha na mão mantém a grade parcial — não volta sozinha', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Remover Preto · P' }));
    await user.click(screen.getByRole('checkbox', { name: 'Branco' }));
    expect(screen.queryByText('Preto · P')).not.toBeInTheDocument();
    expect(screen.getByText('Branco · P')).toBeInTheDocument();
  });

  it('desmarcar a cor inteira e remarcar LIMPA a exclusão manual', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Remover Preto · P' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' })); // desmarca o eixo inteiro
    await user.click(screen.getByRole('checkbox', { name: 'Preto' })); // remarca
    expect(screen.getByText('Preto · P')).toBeInTheDocument();
  });

  it('chip que estouraria 60 fica desabilitado em vez de falhar depois', async () => {
    const user = userEvent.setup();
    renderGrade();
    // Consultas ESCOPADAS ao seletor de cor/tamanho, só neste teste — mesmos papéis e mesmos
    // nomes acessíveis dos outros, só que sem varrer o documento inteiro. Este é o único teste
    // que leva a grade ao teto de 60 linhas (~1.500 nós), e o custo de uma consulta de
    // testing-library cresce com o TAMANHO DO CONTAINER, não com o número de alvos: medido no
    // `screen`, o mesmo `getByRole('checkbox')` custa 6ms com a grade vazia e 2,5s com 60 linhas
    // (~20s só de consulta no teste inteiro, acima do timeout padrão de 5s — e o estouro ainda
    // vazava para o teste seguinte, porque as interações pendentes continuam rodando depois do
    // `cleanup()`). O clique em si é plano (~35ms) o tempo todo: não é lentidão do componente.
    const seletor = within(screen.getByText('Cores e tamanhos').parentElement!);
    for (const t of ['P', 'M', 'G', 'GG']) await user.click(seletor.getByRole('checkbox', { name: t }));
    for (const c of ['Preto', 'Branco', 'Cinza', 'Azul Marinho', 'Azul Royal',
      'Vermelho', 'Verde Bandeira', 'Amarelo', 'Rosa', 'Roxo', 'Marrom', 'Bege']) {
      await user.click(seletor.getByRole('checkbox', { name: c }));
    }
    // 12 cores × 4 tamanhos = 48. Três cores a mais levam a 15 × 4 = 60, exatamente no teto.
    await user.type(seletor.getByLabelText('Nova cor'), 'Verde Musgo{Enter}');
    await user.type(seletor.getByLabelText('Nova cor'), 'Vinho{Enter}');
    await user.type(seletor.getByLabelText('Nova cor'), 'Laranja{Enter}');
    expect(screen.getByText('Laranja · GG')).toBeInTheDocument();
    // A 16ª cor estouraria (64). O botão trava MESMO com texto válido digitado — sem o texto
    // ele já estaria desabilitado por `!novaCor.trim()` e o teste não provaria nada.
    await user.type(seletor.getByLabelText('Nova cor'), 'Caqui');
    expect(seletor.getByRole('button', { name: 'Adicionar cor' })).toBeDisabled();
  });

  it('Enter no campo de nova cor não passa por cima do teto de 60 (achado da revisão final)', async () => {
    const user = userEvent.setup();
    renderGrade();
    const seletor = within(screen.getByText('Cores e tamanhos').parentElement!);
    for (const t of ['P', 'M', 'G', 'GG']) await user.click(seletor.getByRole('checkbox', { name: t }));
    for (const c of ['Preto', 'Branco', 'Cinza', 'Azul Marinho', 'Azul Royal',
      'Vermelho', 'Verde Bandeira', 'Amarelo', 'Rosa', 'Roxo', 'Marrom', 'Bege']) {
      await user.click(seletor.getByRole('checkbox', { name: c }));
    }
    // 12 cores × 4 tamanhos = 48. Três a mais leva a 15 × 4 = 60, exatamente no teto.
    await user.type(seletor.getByLabelText('Nova cor'), 'Verde Musgo{Enter}');
    await user.type(seletor.getByLabelText('Nova cor'), 'Vinho{Enter}');
    await user.type(seletor.getByLabelText('Nova cor'), 'Laranja{Enter}');
    expect(screen.getByText('Laranja · GG')).toBeInTheDocument();
    // A 16ª cor pelo ENTER (não pelo clique no botão) é o caminho que o achado Important aponta
    // como buraco: `adicionarCorPersonalizada` era chamada direto no `onKeyDown`, sem checar
    // `bloquearNovaCor`. Precisa continuar recusada mesmo por este caminho.
    await user.type(seletor.getByLabelText('Nova cor'), 'Caqui{Enter}');
    expect(screen.queryByText('Caqui · GG')).not.toBeInTheDocument();
    expect(screen.queryByText(/Caqui/)).not.toBeInTheDocument();
  });

  // Ordem de CLIQUE não pode virar ordem de LINHA: `Set` preserva inserção, e sem `ordenarEixos`
  // marcar G antes de P produzia "Preto · G" antes de "Preto · P" — e o mesmo desalinho nos
  // códigos de SKU reservados. (Esta assertiva é reescrita na Task 4 para a ordem das COLUNAS.)
  it('ordem de clique não decide a ordem da grade — a ordem canônica decide', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'G' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    const textos = screen.getAllByText(/^Preto · /).map((e) => e.textContent);
    expect(textos).toEqual(['Preto · P', 'Preto · G']);
  });
});

describe('DialogCadastroGrade — herança de campo', () => {
  it('preço do cabeçalho aparece resumido em toda linha sem override', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    expect(screen.getByText(/R\$ 99,90/)).toBeInTheDocument();
  });

  it('mudar o cabeçalho propaga sozinho para quem não destravou', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.clear(screen.getByLabelText('Preço mínimo (líquido)'));
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '150');
    expect(screen.getByText(/R\$ 150/)).toBeInTheDocument();
  });
});

describe('DialogCadastroGrade — aviso de numeração não publicável', () => {
  beforeEach(() => tiposProdutoMock.mockReturnValue({ data: ['calcado'] }));

  it('aparece e some conforme o Gênero do cabeçalho', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'feminino');
    expect(screen.getAllByText(/não publica no Mercado Livre/).length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    // 45/46 publicam no masculino; só os pares continuam avisando.
    expect(screen.getAllByText(/não publica no Mercado Livre/)).toHaveLength(7);
  });
});

describe('DialogCadastroGrade — resumo antes de salvar', () => {
  it('conta SKUs, unidades e linhas sem foto', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.type(screen.getByLabelText('Estoque inicial de Preto · P'), '4');
    expect(screen.getByText(/2 SKUs/)).toBeInTheDocument();
    expect(screen.getByText(/4 unidades/)).toBeInTheDocument();
    expect(screen.getByText(/2 sem foto/)).toBeInTheDocument();
  });
});

// Os testes abaixo buscam os campos do CABEÇALHO por `getByLabelText('Preço mínimo (líquido)')`
// e `getByLabelText('Peso')` — rótulo puro, sem sufixo de unidade e sem "de <cor> · <tamanho>".
// É a regra da Task 8 (`ROTULOS[campo].rotulo`): copiar o `aria-label` da linha aqui quebraria.
describe('DialogCadastroGrade — etapa fiscal (ADR-0135 D-9)', () => {
  beforeEach(() => modulosMock.mockReturnValue({ data: ['fiscal'], isLoading: false }));
  afterEach(() => modulosMock.mockReturnValue({ data: [], isLoading: false }));

  it('com o módulo fiscal, o passo fiscal existe e a numeração de etapas cresce', async () => {
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '50');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.getByLabelText('NCM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });

  // Sem ESTE teste, trocar `fiscalAtivo ? fiscal : undefined` por `undefined` deixaria a suíte
  // inteira verde e o bloco fiscal simplesmente não chegaria na edge — a forma exata do incidente
  // do ORIGEM dropado pelo ingest-lote (duas semanas verde, tudo nacional).
  it('o bloco fiscal preenchido chega ao payload', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '50');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    await user.type(screen.getByLabelText('NCM'), '61091000');
    // Origem fiscal 0 (nacional) de propósito: não está em ORIGENS_COM_FCI, então não abre o
    // campo FCI obrigatório.
    await user.selectOptions(screen.getByLabelText('Origem fiscal (NF-e)'), '0');
    await user.selectOptions(screen.getByLabelText('CSOSN'), '102');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    // `origemNfe` é NÚMERO no payload (montarPayload faz `Number(...)`) — string aqui passaria
    // pelo form e seria recusada pela edge.
    expect(cadastrarProdutoMock.mock.calls[0][0].fiscal).toMatchObject({
      ncm: '61091000', origemNfe: 0, tributacaoIcms: '102',
    });
  });
});

describe('DialogCadastroGrade — salvar', () => {
  // jsdom não implementa URL.createObjectURL/revokeObjectURL, e escolher a foto de uma cor
  // renderiza a miniatura. Mesmo mock de dialog-cadastro-produto.test.tsx.
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn((f: File) => `blob:${f.name}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  // cleanup() explícito ANTES de remover o mock: o cleanup automático do RTL roda num afterEach
  // de escopo mais externo, que só executa DEPOIS deste — sem isto o unmount chama
  // revokeObjectURL já sem o mock e o teste quebra por um motivo que não é o dele.
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('payload tem 1 variação por combinação, com os herdados já resolvidos', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }, { id: 'v2', codigo: '00000002' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.type(screen.getByLabelText('Peso'), '300');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    const p = cadastrarProdutoMock.mock.calls[0][0];
    expect(p.genero).toBe('masculino');
    expect(p.variacoes).toHaveLength(2);
    expect(p.variacoes[0]).toMatchObject({ nome: 'Preto', tamanho: 'P', preco: 99.9, pesoGramas: 300 });
    expect(p.variacoes[1]).toMatchObject({ nome: 'Preto', tamanho: 'M', preco: 99.9, pesoGramas: 300 });
  });

  it('override de uma linha vence o cabeçalho no payload', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: /Editar nesta linha/i }));
    await user.click(screen.getByRole('button', { name: 'Destravar Preço mínimo (líquido) de Preto · P' }));
    await user.clear(screen.getByLabelText('Preço mínimo (líquido) de Preto · P'));
    await user.type(screen.getByLabelText('Preço mínimo (líquido) de Preto · P'), '129,90');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrarProdutoMock).toHaveBeenCalledTimes(1));
    expect(cadastrarProdutoMock.mock.calls[0][0].variacoes[0].preco).toBe(129.9);
  });

  it('a foto da COR vai para TODA linha daquela cor, uma por SKU', async () => {
    cadastrarProdutoMock.mockResolvedValueOnce({
      loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [],
      variacoes: [{ id: 'v1', codigo: '00000001' }, { id: 'v2', codigo: '00000002' }],
    });
    const user = userEvent.setup();
    renderGrade();
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.upload(screen.getByLabelText('Foto da cor Preto'), new File(['x'], 'preto.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    const { uploadFotoProduto } = await import('@/lib/produtos-saldo');
    await waitFor(() => expect(uploadFotoProduto).toHaveBeenCalledTimes(2));
    expect(vi.mocked(uploadFotoProduto).mock.calls[0][3]).toEqual({ tipo: 'variacao', variacaoId: 'v1' });
    expect(vi.mocked(uploadFotoProduto).mock.calls[1][3]).toEqual({ tipo: 'variacao', variacaoId: 'v2' });
  });

  it('durante o salvamento a grade fica congelada (casamento posicional)', async () => {
    let liberar: (v: unknown) => void = () => {};
    cadastrarProdutoMock.mockReturnValueOnce(new Promise((res) => { liberar = res; }));
    // 2 tipos de propósito: é o que faz "Trocar tipo" existir na tela. Ele apaga as linhas — com
    // 1 tipo só o botão nem renderiza e o congelamento dele ficaria sem teste.
    tiposProdutoMock.mockReturnValue({ data: ['roupa', 'calcado'] });
    const user = userEvent.setup();
    renderGrade();
    await user.click(screen.getByRole('button', { name: 'Roupa' }));
    await user.type(screen.getByLabelText('Nome'), 'Camiseta');
    await user.click(screen.getByRole('radio', { name: 'Nacional' }));
    await user.selectOptions(screen.getByLabelText(/^Gênero/i), 'masculino');
    await user.type(screen.getByLabelText('Preço mínimo (líquido)'), '99,90');
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(screen.getByRole('checkbox', { name: 'Branco' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover Preto · P' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trocar tipo' })).toBeDisabled();
    // Soltar a promise e ESPERAR a etapa 2 aparecer: sem isso o `setState` do resultado cai
    // fora do `act` e vaza para o teste seguinte.
    liberar({ loteId: 'l1', familiaId: 'f1', filaOk: true, falhasEstoque: [], variacoes: [{ id: 'v1', codigo: '00000001' }] });
    await waitFor(() => expect(screen.getByText('Foto por variação')).toBeInTheDocument());
  });
});
