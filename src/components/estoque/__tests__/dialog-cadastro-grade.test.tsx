import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
