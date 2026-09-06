// ADR-0154: diálogo de criação de Kit Virtual. Cobre os pontos que o plano de entrega pede:
// inelegível não selecionável (com motivo visível), publicar desabilitado sem foto, publicar
// HABILITADO com margem indisponível (Decisão 6 — nunca bloqueia), seleção fora de 2..6
// bloqueada, e descrição por IA só ao clicar (Decisão 4 — não pode ser apagada por um ajuste
// de desconto, que também chama a mesma edge de preview).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DialogCriarKitVirtual } from '../DialogCriarKitVirtual';
import type {
  ComponenteCandidatoKitVirtual, PreviewKitVirtualResultado, ResultadoCriarKitVirtual,
  ResultadoBuscarComponentesKitVirtual, ResultadoSubirFotoKitVirtual, KitVirtualParaRefazer,
} from '@/lib/kit-virtual';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

// jsdom não implementa URL.createObjectURL — CampoFoto/MiniaturaFoto chamam na escolha do
// arquivo pra montar o preview. Sem isto o teste de upload de foto quebra com
// "URL.createObjectURL is not a function" (só não aparecia isolado por acaso, quando outro
// arquivo da suíte cheia já tinha poluído o global antes do worker chegar aqui).
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = vi.fn();
}

const buscarComponentesMock = vi.fn<(searchText?: string) => Promise<ResultadoBuscarComponentesKitVirtual>>();
const previewMock = vi.fn();
const criarMock = vi.fn<(input: unknown) => Promise<ResultadoCriarKitVirtual>>();
const subirFotoMlMock = vi.fn<(path: string) => Promise<ResultadoSubirFotoKitVirtual>>()
  .mockResolvedValue({ ok: true, pictureId: 'PIC-123' });
vi.mock('@/lib/kit-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kit-virtual')>();
  return {
    ...actual,
    buscarComponentesKitVirtual: (searchText?: string) => buscarComponentesMock(searchText),
    previewKitVirtual: (input: unknown) => previewMock(input),
    criarKitVirtualEdge: (input: unknown) => criarMock(input),
    subirFotoKitVirtualEdge: (path: string) => subirFotoMlMock(path),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  },
}));
vi.mock('@/stores/support-store', () => ({
  effectiveOrgId: () => 'org-1',
  useSupportStore: { getState: () => ({ context: null }) },
}));
vi.mock('@/hooks/useUploadLote', () => ({
  storageOwnerForUpload: () => 'owner-1',
}));
const uploadFileMock = vi.fn().mockResolvedValue('owner-1/kit-virtual-chave/foto.jpg');
vi.mock('@/lib/storage', () => ({
  uploadFile: (...args: unknown[]) => uploadFileMock(...args),
  buildStoragePath: (owner: string, pasta: string, nome: string) => `${owner}/${pasta}/${nome}`,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function candidato(over: Partial<ComponenteCandidatoKitVirtual> = {}): ComponenteCandidatoKitVirtual {
  return {
    userProductId: 'UP-A', itemId: 'MLB1', title: 'Motosserra Elétrica', type: 'available',
    thumbnailUrl: null, categoryName: 'Ferramentas', estoque: 20,
    reasons: [], codigo: '00000001', codigoPai: '00000001', custo: 40, origem: 'nacional',
    kitMultiplicador: null, precoAtualML: 100, categoriaMlId: 'MLB1234', ...over,
  };
}

const PRODUTO_A = candidato({
  userProductId: 'UP-A', title: 'Motosserra Elétrica', codigo: '00000001', codigoPai: '00000001',
  precoAtualML: 100, categoriaMlId: 'MLB1234',
});
const PRODUTO_B = candidato({
  userProductId: 'UP-B', title: 'Canivete Retrátil', codigo: '00000002', codigoPai: '00000002',
  precoAtualML: 50, categoriaMlId: 'MLB5678',
});
const INELEGIVEL = candidato({
  userProductId: 'UP-C', title: 'Linha Várias Cores', type: 'non_available', codigo: null, codigoPai: null,
  precoAtualML: null, categoriaMlId: null,
  reasons: [{ id: 'COMPONENT_NOT_MIGRATED_TO_UP', message: 'Não está atualizado para a nova experiência de variações' }],
});

function mockBusca(elegiveis = [PRODUTO_A, PRODUTO_B], inelegiveis = [INELEGIVEL]) {
  buscarComponentesMock.mockResolvedValue({ elegiveis, inelegiveis });
}

function mockPreview(resultado: Partial<PreviewKitVirtualResultado> = {}) {
  previewMock.mockImplementation(async () => ({
    titulo: 'Kit 2 itens: 1 Motosserra Elétrica + 1 Canivete Retrátil',
    descontoPct: 0,
    descricao: null,
    descricaoGeradaPorIA: false,
    avisoKitVinculado: false,
    margemEstimativa: true as const,
    margem: { ok: true, precoKit: 150, rateio: [], custoTotal: 60, impostoTotal: 12, liquido: 100, margemPct: 26.7 },
    ...resultado,
  }));
}

function renderDialog(refazerDe?: KitVirtualParaRefazer) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <DialogCriarKitVirtual open onOpenChange={onOpenChange} refazerDe={refazerDe} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

async function linhaDoProduto(titulo: string) {
  const texto = await screen.findByText(titulo);
  return texto.closest('li') as HTMLElement;
}

async function selecionarDoisComponentes() {
  const linhaA = await linhaDoProduto('Motosserra Elétrica');
  await userEvent.click(within(linhaA).getByRole('button', { name: /Adicionar/i }));
  const linhaB = await linhaDoProduto('Canivete Retrátil');
  await userEvent.click(within(linhaB).getByRole('button', { name: /Adicionar/i }));
}

async function anexarFoto() {
  const file = new File(['foto'], 'kit.jpg', { type: 'image/jpeg' });
  await userEvent.upload(screen.getByLabelText('Foto do kit'), file);
  await waitFor(() => expect(uploadFileMock).toHaveBeenCalled());
}

describe('DialogCriarKitVirtual — inelegíveis', () => {
  it('mostra o inelegível com o motivo e ele não é selecionável', async () => {
    mockBusca();
    renderDialog();

    await screen.findByText('Motosserra Elétrica'); // aguarda a busca resolver antes de interagir
    await userEvent.click(screen.getByText(/1 produto não pode entrar no kit/));
    expect(await screen.findByText('Linha Várias Cores')).toBeInTheDocument();
    expect(screen.getByText('Não está atualizado para a nova experiência de variações')).toBeInTheDocument();
    // Nenhum botão "Adicionar" na linha do inelegível — só o card informativo, sem controle de seleção.
    const linhaInelegivel = screen.getByText('Linha Várias Cores').closest('li') as HTMLElement;
    expect(within(linhaInelegivel).queryByRole('button', { name: /Adicionar/i })).not.toBeInTheDocument();
  });
});

describe('DialogCriarKitVirtual — seleção fora de 2..6', () => {
  it('com 1 componente selecionado, "Avançar" fica desabilitado', async () => {
    mockBusca();
    renderDialog();

    const linhaA = await linhaDoProduto('Motosserra Elétrica');
    await userEvent.click(within(linhaA).getByRole('button', { name: /Adicionar/i }));

    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
  });

  it('com 2 componentes, preço e categoria resolvidos, "Avançar" habilita', async () => {
    mockBusca();
    renderDialog();

    await selecionarDoisComponentes();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Avançar' })).not.toBeDisabled());
  });
});

describe('DialogCriarKitVirtual — foto obrigatória só bloqueia o publicar', () => {
  it('sem foto: "Publicar kit" fica desabilitado mesmo depois do preview carregar', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));

    await waitFor(() => expect(previewMock).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Publicar kit' })).toBeDisabled();
  });

  it('com foto enviada, "Publicar kit" habilita', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await anexarFoto();
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));

    await waitFor(() => expect(previewMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
  });
});

describe('DialogCriarKitVirtual — margem indisponível não bloqueia (Decisão 6)', () => {
  it('margem {ok:false} mostra "margem indisponível" e mantém "Publicar kit" habilitado', async () => {
    mockBusca();
    mockPreview({ margem: { ok: false, faltando: [{ ordem: 0, campo: 'custo' }] } });
    renderDialog();

    await selecionarDoisComponentes();
    await anexarFoto();
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));

    expect(await screen.findByText(/margem indisponível: falta custo em Motosserra Elétrica/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
  });
});

describe('DialogCriarKitVirtual — descrição por IA só ao clicar (Decisão 4)', () => {
  it('entrar no preview NÃO gera descrição; só o botão "Gerar descrição com IA" gera', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ gerarDescricao: false }));
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('');

    mockPreview({ descricao: 'Descrição gerada pela IA.', descricaoGeradaPorIA: true });
    await userEvent.click(screen.getByRole('button', { name: 'Gerar descrição com IA' }));

    await waitFor(() => expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Descrição gerada pela IA.'));
    expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ gerarDescricao: true }));
  });

  it('mudar o desconto dispara um novo preview mas NÃO apaga a descrição já gerada', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await vi.waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));

    mockPreview({ descricao: 'Descrição gerada pela IA.', descricaoGeradaPorIA: true });
    await userEvent.click(screen.getByRole('button', { name: 'Gerar descrição com IA' }));
    await vi.waitFor(() => expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Descrição gerada pela IA.'));

    // Preview volta a responder sem descrição (gerar_descricao:false) — o normal de qualquer
    // chamada disparada só pelo ajuste de desconto.
    mockPreview({ descricao: null, descricaoGeradaPorIA: false });
    await userEvent.type(screen.getByLabelText('Desconto do kit (%)'), '5');
    await vi.advanceTimersByTimeAsync(600);

    await vi.waitFor(() => expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ gerarDescricao: false })));
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Descrição gerada pela IA.');
    vi.useRealTimers();
  });
});

describe('DialogCriarKitVirtual — publicar', () => {
  it('sucesso: toast de sucesso e o diálogo fecha', async () => {
    mockBusca();
    mockPreview();
    criarMock.mockResolvedValue({
      ok: true, kitId: 'kit-1', mlItemId: 'MLB999', mlUserProductId: 'UP999', mlPermalink: 'https://x', jaExistia: false,
    });
    const { onOpenChange } = renderDialog();

    await selecionarDoisComponentes();
    await anexarFoto();
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('recusa da edge: mostra a mensagem humanizada no toast de erro', async () => {
    mockBusca();
    mockPreview();
    criarMock.mockResolvedValue({ ok: false, motivo: 'ml_recusou', mensagem: 'O Mercado Livre recusou: kit duplicado.' });
    renderDialog();

    await selecionarDoisComponentes();
    await anexarFoto();
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Falha ao criar kit',
      expect.objectContaining({ description: 'O Mercado Livre recusou: kit duplicado.' }),
    ));
  });
});

describe('DialogCriarKitVirtual — foto sobe ao ML no upload, não no publicar (ADR-0154 D-5/ADR-0033)', () => {
  it('picture_id do upload viaja para o publicar', async () => {
    mockBusca();
    mockPreview();
    criarMock.mockResolvedValue({
      ok: true, kitId: 'kit-1', mlItemId: 'MLB1', mlUserProductId: null, mlPermalink: null, jaExistia: false,
    });
    renderDialog();

    await selecionarDoisComponentes();
    await anexarFoto();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledWith(expect.stringContaining('kit-virtual-')));

    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));

    await waitFor(() => expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({ fotoMlPictureId: 'PIC-123' })));
  });

  it('falha do upload ao ML não trava o diálogo — publicar segue habilitado, sem picture_id (fallback do publicar cobre)', async () => {
    subirFotoMlMock.mockResolvedValueOnce({ ok: false, mensagem: 'Falha ao subir foto (400): recusado' });
    mockBusca();
    mockPreview();
    criarMock.mockResolvedValue({
      ok: true, kitId: 'kit-1', mlItemId: 'MLB1', mlUserProductId: null, mlPermalink: null, jaExistia: false,
    });
    renderDialog();

    await selecionarDoisComponentes();
    await anexarFoto();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));

    await waitFor(() => expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({ fotoMlPictureId: null })));
  });
});

describe('DialogCriarKitVirtual — refazerDe pré-preenche (ADR-0154 D-8)', () => {
  function refazerDeExemplo(): KitVirtualParaRefazer {
    return {
      componentes: [
        { candidato: PRODUTO_A, quantidade: 2, precoAtualML: 100 },
        { candidato: PRODUTO_B, quantidade: 1, precoAtualML: 50 },
      ],
      titulo: 'Kit Aventura: 1 Motosserra + 1 Canivete',
      descricao: 'Descrição antiga do kit.',
      descontoPct: 15,
      fotoStoragePath: 'org-1/kit-virtual-antigo/foto.jpg',
      fotoMlPictureId: 'PIC-ANTIGO',
    };
  }

  it('abre já com a composição, foto reusada e "Avançar" habilitado, sem precisar buscar/re-anexar nada', async () => {
    mockBusca();
    mockPreview();
    renderDialog(refazerDeExemplo());

    expect(await screen.findByText('Composição (2/6)')).toBeInTheDocument();
    expect(screen.getByText('Motosserra Elétrica')).toBeInTheDocument();
    expect(screen.getByText('Canivete Retrátil')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantidade de Motosserra Elétrica')).toHaveValue(2);
    expect(screen.getByText('✓ enviada')).toBeInTheDocument(); // foto do kit antigo, sem upload novo
    expect(screen.getByRole('button', { name: 'Avançar' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));

    expect(await screen.findByLabelText('Título do kit')).toHaveValue('Kit Aventura: 1 Motosserra + 1 Canivete');
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Descrição antiga do kit.');
    expect(screen.getByLabelText('Desconto do kit (%)')).toHaveValue(15);
    // Foto já reusada — "Publicar kit" não fica preso esperando um novo upload.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
  });

  // Defeito A da revisão final: o Refazer NÃO pode mandar o `listing_type_id` do kit antigo —
  // ele existe para TROCAR componente, e um componente novo de outro tipo faria o ML recusar
  // com o mesmo `listing_type_mismatch` de 2026-09-06. A edge deriva; o diálogo não opina.
  it('publicar reusa a foto do kit antigo, mas NÃO manda listingTypeId (a edge deriva dos componentes)', async () => {
    mockBusca();
    mockPreview();
    criarMock.mockResolvedValue({
      ok: true, kitId: 'kit-2', mlItemId: 'MLB2', mlUserProductId: null, mlPermalink: null, jaExistia: false,
    });
    renderDialog(refazerDeExemplo());

    await userEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));

    await waitFor(() => expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({
      fotoMlPictureId: 'PIC-ANTIGO',
      fotoStoragePath: 'org-1/kit-virtual-antigo/foto.jpg',
    })));
    expect(criarMock.mock.calls[0][0]).not.toHaveProperty('listingTypeId');
    expect(subirFotoMlMock).not.toHaveBeenCalled();
  });
});

describe('DialogCriarKitVirtual — sem refazerDe, o diálogo continua em branco', () => {
  it('sem a prop: sem composição pré-selecionada, sem foto, "Avançar" desabilitado', async () => {
    mockBusca();
    renderDialog(); // refazerDe ausente — mesmo comportamento de sempre

    await screen.findByText('Motosserra Elétrica'); // busca resolveu
    expect(screen.queryByText(/^Composição \(/)).not.toBeInTheDocument();
    expect(screen.queryByText('✓ enviada')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
  });
});

describe('DialogCriarKitVirtual — categoria não resolvida bloqueia só quem lidera', () => {
  it('produto sem categoria conhecida não pode ser principal', async () => {
    // categoriaMlId: null isola exatamente o que este teste cobre — precoAtualML continua
    // preenchido pra não também derrubar `precosValidos`.
    const semCategoria = candidato({ userProductId: 'UP-D', title: 'Produto Sem Categoria', categoriaMlId: null });
    mockBusca([semCategoria, PRODUTO_B], []);
    renderDialog();

    const linha = await linhaDoProduto('Produto Sem Categoria');
    await userEvent.click(within(linha).getByRole('button', { name: /Adicionar/i }));
    const linhaB = await linhaDoProduto('Canivete Retrátil');
    await userEvent.click(within(linhaB).getByRole('button', { name: /Adicionar/i }));

    expect(await screen.findByText(/não pode ser o principal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Tornar principal' }));
    await waitFor(() => expect(screen.queryByText(/não pode ser o principal/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Avançar' })).not.toBeDisabled();
  });
});
