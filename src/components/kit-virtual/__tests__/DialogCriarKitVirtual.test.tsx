// ADR-0154 + ADR-0206: diálogo de criação de Kit Virtual em 2 etapas (1. Composição, 2. Anúncio).
// Cobre: inelegível não selecionável, foto obrigatória só no publicar, margem indisponível não
// bloqueia (Decisão 6), seleção fora de 2..6 bloqueada, texto IA automático ao entrar na etapa 2
// (só quando a composição mudou), "Regerar" com confirmação sobre edição manual, resposta velha
// descartada, e troca de capa (upload manual ↔ capa IA ↔ Refazer) sempre com o picture id novo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('@/lib/capa-kit-virtual-edge', () => ({ gerarCapaKitVirtualEdge: vi.fn() }));
import { gerarCapaKitVirtualEdge } from '@/lib/capa-kit-virtual-edge';
const capaEdgeMock = vi.mocked(gerarCapaKitVirtualEdge);
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ['imagem_ia'] }) }));
// O card de recebe avulso tem testes próprios; aqui só precisa renderizar sem rede.
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: undefined, isLoading: false, isError: false }),
}));

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
  subirFotoMlMock.mockReset();
  subirFotoMlMock.mockResolvedValue({ ok: true, pictureId: 'PIC-123' });
});

function candidato(over: Partial<ComponenteCandidatoKitVirtual> = {}): ComponenteCandidatoKitVirtual {
  return {
    userProductId: 'UP-A', itemId: 'MLB1', title: 'Motosserra Elétrica', type: 'available',
    thumbnailUrl: null, categoryName: 'Ferramentas', estoque: 20,
    reasons: [], codigo: '00000001', codigoPai: '00000001', custo: 40, origem: 'nacional',
    kitMultiplicador: null, precoAtualML: 100, categoriaMlId: 'MLB1234', listingTypeId: null, medidas: null, ...over,
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

const TITULO_IA = 'Kit Motosserra Elétrica e Canivete Retrátil';
const DESCRICAO_IA = 'Descrição gerada pela IA.';

/** Com `gerarDescricao:true` a edge devolve título IA + descrição; com false, template e descrição null. */
function respostaPreview(input: { gerarDescricao: boolean }, resultado: Partial<PreviewKitVirtualResultado> = {}): PreviewKitVirtualResultado {
  return {
    titulo: input.gerarDescricao ? TITULO_IA : 'Kit 2 itens: 1 Motosserra Elétrica + 1 Canivete Retrátil',
    tituloGeradoPorIA: input.gerarDescricao,
    descontoPct: 0,
    descricao: input.gerarDescricao ? DESCRICAO_IA : null,
    descricaoGeradaPorIA: input.gerarDescricao,
    avisoKitVinculado: false,
    margemEstimativa: true as const,
    margem: { ok: true, precoKit: 150, rateio: [], custoTotal: 60, impostoTotal: 12, liquido: 100, margemPct: 26.7 },
    ...resultado,
  };
}

function mockPreview(resultado: Partial<PreviewKitVirtualResultado> = {}) {
  previewMock.mockImplementation(async (input: { gerarDescricao: boolean }) => respostaPreview(input, resultado));
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

async function avancar() {
  await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
  await screen.findByRole('button', { name: 'Publicar kit' });
}

/** Upload manual — o campo só existe na etapa 2. */
async function anexarFoto(nome = 'kit.jpg') {
  const file = new File(['foto'], nome, { type: 'image/jpeg' });
  await userEvent.upload(await screen.findByLabelText('Foto do kit'), file);
  await waitFor(() => expect(uploadFileMock).toHaveBeenCalledWith('imagens', expect.stringContaining(nome), file));
}

function deferido<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    await avancar();
    await anexarFoto();

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
    await avancar();
    await anexarFoto();

    expect(await screen.findByText(/margem indisponível: falta custo em Motosserra Elétrica/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
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
    await avancar();
    await anexarFoto();
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
    await avancar();
    await anexarFoto();
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
    await avancar();
    await anexarFoto();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledWith(expect.stringContaining('kit-virtual-')));
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
    await avancar();
    await anexarFoto();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalled());
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
    expect(screen.getByRole('button', { name: 'Avançar' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));

    expect(await screen.findByText('✓ enviada')).toBeInTheDocument(); // foto do kit antigo, sem upload novo
    expect(await screen.findByLabelText('Título do kit')).toHaveValue('Kit Aventura: 1 Motosserra + 1 Canivete');
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Descrição antiga do kit.');
    expect(screen.getByLabelText('Desconto do kit (%)')).toHaveValue(15);
    // Foto já reusada — "Publicar kit" não fica preso esperando um novo upload.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    // Refazer: composição igual à herdada → nenhuma geração automática de texto.
    await esperar(700);
    expect(previewMock).not.toHaveBeenCalledWith(expect.objectContaining({ gerarDescricao: true }));
    expect(screen.getByLabelText('Título do kit')).toHaveValue('Kit Aventura: 1 Motosserra + 1 Canivete');
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Descrição antiga do kit.');
  });

  it('Refazer → trocar a foto: zera o picture id antigo e publica com o da foto nova', async () => {
    mockBusca();
    mockPreview();
    subirFotoMlMock.mockResolvedValue({ ok: true, pictureId: 'PIC-NOVA' });
    criarMock.mockResolvedValue({ ok: true, kitId: 'kit-3', mlItemId: 'MLB3', mlUserProductId: null, mlPermalink: null, jaExistia: false });
    renderDialog(refazerDeExemplo());

    await userEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar' }));
    await anexarFoto('nova.jpg');
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledWith(expect.stringContaining('nova.jpg')));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));

    await waitFor(() => expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({
      fotoMlPictureId: 'PIC-NOVA',
      fotoStoragePath: expect.stringContaining('nova.jpg'),
    })));
  });

  it('descrição herdada com rótulo Metragem para ml abre como Volume', async () => {
    mockBusca();
    mockPreview();
    renderDialog({ ...refazerDeExemplo(), descricao: '• Metragem: 120ml' });


    await userEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    expect(await screen.findByLabelText('Descrição do kit')).toHaveValue('• Volume: 120ml');
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

describe('DialogCriarKitVirtual — 2 etapas (ADR-0206)', () => {
  it('pílulas "1. Composição" / "2. Anúncio"; a etapa 1 não tem mais a foto do kit', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    expect(screen.getByText('1. Composição')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('2. Anúncio')).toBeInTheDocument();
    await screen.findByText('Motosserra Elétrica');
    expect(screen.queryByLabelText('Foto do kit')).not.toBeInTheDocument();

    await selecionarDoisComponentes();
    await avancar();
    expect(screen.getByText('2. Anúncio')).toHaveAttribute('aria-current', 'step');
    expect(await screen.findByLabelText('Foto do kit')).toBeInTheDocument();
  });
});

describe('DialogCriarKitVirtual — texto IA automático na etapa 2', () => {
  it('entrar gera título e descrição uma vez; voltar e avançar sem mudar a composição não gera de novo', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    await waitFor(() => expect(screen.getByLabelText('Título do kit')).toHaveValue(TITULO_IA));
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue(DESCRICAO_IA);
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ gerarDescricao: true }));

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await avancar();
    await esperar(700);
    expect(previewMock).toHaveBeenCalledTimes(1);
  });

  it('mudar a quantidade e avançar gera de novo e zera a capa já escolhida', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    await anexarFoto();
    await waitFor(() => expect(screen.getByText('✓ enviada')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.change(screen.getByLabelText('Quantidade de Motosserra Elétrica'), { target: { value: '2' } });
    await avancar();

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2));
    expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ gerarDescricao: true }));
    expect(screen.queryByText('✓ enviada')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar kit' })).toBeDisabled();
  });

  it('resposta de texto que chega depois de a composição mudar é descartada', async () => {
    mockBusca();
    const velho = deferido<PreviewKitVirtualResultado>();
    previewMock.mockImplementationOnce(() => velho.promise);
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.change(screen.getByLabelText('Quantidade de Motosserra Elétrica'), { target: { value: '2' } });
    const novo = deferido<PreviewKitVirtualResultado>();
    previewMock.mockImplementationOnce(() => novo.promise);
    await avancar();
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2));

    velho.resolve(respostaPreview({ gerarDescricao: true }, { titulo: 'Kit VELHO', descricao: 'Descrição velha.' }));
    await esperar(50);
    expect(screen.getByLabelText('Título do kit')).toHaveValue('');
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('');

    novo.resolve(respostaPreview({ gerarDescricao: true }, { titulo: 'Kit NOVO', descricao: 'Descrição nova.' }));
    await waitFor(() => expect(screen.getByLabelText('Título do kit')).toHaveValue('Kit NOVO'));
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Descrição nova.');
  });

  it('tituloGeradoPorIA:false mostra o aviso discreto do título padrão', async () => {
    mockBusca();
    mockPreview({ tituloGeradoPorIA: false });
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    expect(await screen.findByText('Título padrão: a IA não gerou um título válido')).toBeInTheDocument();
  });

  it('ajuste de desconto recalcula a margem sem sobrescrever título nem descrição', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    await waitFor(() => expect(screen.getByLabelText('Título do kit')).toHaveValue(TITULO_IA));
    await userEvent.clear(screen.getByLabelText('Título do kit'));
    await userEvent.type(screen.getByLabelText('Título do kit'), 'Kit do operador');

    await userEvent.type(screen.getByLabelText('Desconto do kit (%)'), '5');
    await waitFor(() => expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ gerarDescricao: false })), { timeout: 2000 });
    await esperar(50);
    expect(screen.getByLabelText('Título do kit')).toHaveValue('Kit do operador');
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue(DESCRICAO_IA);
  });
});

describe('DialogCriarKitVirtual — Regerar', () => {
  async function entrarNaEtapa2() {
    mockBusca();
    mockPreview();
    renderDialog();
    await selecionarDoisComponentes();
    await avancar();
    await waitFor(() => expect(screen.getByLabelText('Título do kit')).toHaveValue(TITULO_IA));
  }

  it('sem edição manual: regera direto com gerarDescricao:true', async () => {
    await entrarNaEtapa2();
    mockPreview({ titulo: 'Kit Regerado', descricao: 'Outra descrição.' });

    await userEvent.click(screen.getByRole('button', { name: 'Regerar' }));

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2));
    expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ gerarDescricao: true }));
    await waitFor(() => expect(screen.getByLabelText('Título do kit')).toHaveValue('Kit Regerado'));
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue('Outra descrição.');
  });

  it('com título editado à mão: pede confirmação antes de sobrescrever', async () => {
    await entrarNaEtapa2();
    await userEvent.type(screen.getByLabelText('Título do kit'), ' X');

    await userEvent.click(screen.getByRole('button', { name: 'Regerar' }));
    expect(await screen.findByText(/substitui o título e a descrição que você editou/)).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Substituir' }));
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('Título do kit')).toHaveValue(TITULO_IA));
  });

  it('com descrição editada à mão: pede confirmação; "Manter meu texto" não regera', async () => {
    await entrarNaEtapa2();
    await userEvent.type(screen.getByLabelText('Descrição do kit'), ' Minha nota.');

    await userEvent.click(screen.getByRole('button', { name: 'Regerar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Manter meu texto' }));
    await esperar(50);
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Descrição do kit')).toHaveValue(`${DESCRICAO_IA} Minha nota.`);
  });
});

describe('DialogCriarKitVirtual — capa (IA ↔ upload manual)', () => {
  const CAPA_IA = { ok: true as const, tentativa: 1, aprovado: true, proxima: false, path: 'org-1/kit-virtual-ia/req.png', url: 'https://x/capa.png' };

  async function usarCapaIA() {
    capaEdgeMock.mockResolvedValue(CAPA_IA);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar capa do kit' }));
    fireEvent.load(await screen.findByAltText('Capa do kit gerada por IA'));
    await userEvent.click(screen.getByRole('button', { name: 'Usar capa gerada do kit' }));
  }

  it('"Usar esta foto" vira a foto do kit e sobe ao ML; "Publicar kit" exige foto', async () => {
    mockBusca();
    mockPreview();
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    await waitFor(() => expect(previewMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Publicar kit' })).toBeDisabled();

    await usarCapaIA();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledWith(CAPA_IA.path));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
  });

  it('upload manual → capa IA: ignora a subida atrasada da foto anterior e publica com o picture id novo', async () => {
    mockBusca();
    mockPreview();
    criarMock.mockResolvedValue({ ok: true, kitId: 'kit-1', mlItemId: 'MLB1', mlUserProductId: null, mlPermalink: null, jaExistia: false });
    const subidaManual = deferido<ResultadoSubirFotoKitVirtual>();
    subirFotoMlMock.mockImplementation((path: string) => (path === CAPA_IA.path
      ? Promise.resolve({ ok: true, pictureId: 'PIC-IA' })
      : subidaManual.promise));
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    await anexarFoto();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledWith(expect.stringContaining('kit.jpg')));

    await usarCapaIA();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledWith(CAPA_IA.path));
    subidaManual.resolve({ ok: true, pictureId: 'PIC-MANUAL' }); // resposta atrasada da foto anterior
    await esperar(50);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));
    await waitFor(() => expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({
      fotoStoragePath: CAPA_IA.path, fotoMlPictureId: 'PIC-IA',
    })));
  });

  it('upload manual com picture id → capa IA: o picture id antigo nunca viaja com a foto nova', async () => {
    mockBusca();
    mockPreview();
    criarMock.mockResolvedValue({ ok: true, kitId: 'kit-1', mlItemId: 'MLB1', mlUserProductId: null, mlPermalink: null, jaExistia: false });
    const subidaIA = deferido<ResultadoSubirFotoKitVirtual>();
    subirFotoMlMock.mockImplementation((path: string) => (path === CAPA_IA.path
      ? subidaIA.promise
      : Promise.resolve({ ok: true, pictureId: 'PIC-MANUAL' })));
    renderDialog();

    await selecionarDoisComponentes();
    await avancar();
    await anexarFoto();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledTimes(1));
    await esperar(20); // PIC-MANUAL assentou

    await usarCapaIA();
    await waitFor(() => expect(subirFotoMlMock).toHaveBeenCalledWith(CAPA_IA.path));
    // Antes da nova subida responder, publicar manda o path novo SEM o picture id antigo.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publicar kit' })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Publicar kit' }));
    await waitFor(() => expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({
      fotoStoragePath: CAPA_IA.path, fotoMlPictureId: null,
    })));
    await act(async () => subidaIA.resolve({ ok: true, pictureId: 'PIC-IA' }));
  });
});
