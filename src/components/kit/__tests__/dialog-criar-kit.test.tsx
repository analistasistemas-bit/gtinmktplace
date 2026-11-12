// ADR-0151 (fix round pós-revisão-final, achado da re-revisão): o botão "Reenviar" (I-1)
// re-dispara publicarFamilias([familiaId]) — uma publicação real no ML — a partir de um
// ponto de entrada de UI novo. Cobre: visibilidade condicional a status='erro', o payload do
// clique, o aviso de falso-positivo (enfileiradas===0) e o dedupe por criadoEm mais recente
// (M-1) que decide qual linha manda no botão.
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DialogCriarKit } from '../dialog-criar-kit';
import type { KitVinculado } from '@/lib/queries';
import type { BaseParaKit } from '@/lib/kit';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const publicarFamiliasMock = vi.fn();
vi.mock('@/lib/publicar', () => ({
  publicarFamilias: (...args: unknown[]) => publicarFamiliasMock(...args),
}));

// Toast pós-criação (botão "Acompanhar" → /relatorio/:loteId): mocka só `criarKitVinculado`,
// mantendo TAMANHOS_KIT/tituloDoKit/descricaoDoKit/precoSugeridoDoKit reais.
const criarKitVinculadoMock = vi.fn();
vi.mock('@/lib/kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kit')>();
  return { ...actual, criarKitVinculado: (...args: unknown[]) => criarKitVinculadoMock(...args) };
});

// "Você recebe" do preview: tarifa oficial e alíquota confirmada (sem rede).
const tarifaOficial = (preco: number, aliquotaPct: number) => {
  const imposto = Math.round(preco * aliquotaPct) / 100;
  const tipo = (pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto, recebe: Math.round((preco - comissao - 10 - imposto) * 100) / 100 };
  };
  return { classico: tipo(12), premium: tipo(17), frete: 10, proveniencia: 'official' as const };
};
vi.mock('@/lib/tarifa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tarifa')>('@/lib/tarifa');
  return { ...actual, calcularTarifaML: vi.fn(async (preco: number, _c: string, _d: unknown, aliq = 0) => tarifaOficial(preco, aliq)) };
});
const aliquotasMock = { data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true };
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliquotasMock }));

// ADR-0205: módulos da org e edge da capa com N unidades (sem rede); upload fora do storage real.
const modulosMock: { data: string[] | undefined } = { data: [] };
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulosMock }));
const gerarCapaMock = vi.fn();
vi.mock('@/lib/capa-unidades-edge', () => ({ gerarCapaUnidadesEdge: (...a: unknown[]) => gerarCapaMock(...a) }));
const uploadFileMock = vi.fn();
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, uploadFile: (...a: unknown[]) => uploadFileMock(...a) };
});

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

const buscarCategoriaMLMock = vi.fn();
vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>();
  return { ...actual, buscarCategoriaML: (...args: unknown[]) => buscarCategoriaMLMock(...args) };
});

// O caminho completo da categoria vem de um GET público na API do ML — sem mock, cada render
// tentaria rede real (verde na máquina do dev, vermelho no CI sem egresso).
const caminhoCategoriaMLMock = vi.fn(async (_id: string) => [] as string[]);
vi.mock('@/lib/caminho-categoria-ml', () => ({
  caminhoCategoriaML: (id: string) => caminhoCategoriaMLMock(id),
}));

// subirFoto (via uploadFile/@/lib/storage) e useImageUrl chamam supabase direto — sem mockar,
// o teste do fluxo de criação bateria na rede real.
const invokeMock = vi.fn();
const signedPaths: string[] = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    storage: { from: () => ({ createSignedUrl: (path: string) => { signedPaths.push(path); return Promise.resolve({ data: { signedUrl: 'https://x.test/foto.jpg' }, error: null }); } }) },
  },
}));
vi.mock('@/stores/support-store', () => ({
  effectiveOrgId: () => 'org-1',
  useSupportStore: { getState: () => ({ context: null }) },
}));
vi.mock('@/hooks/useUploadLote', () => ({
  storageOwnerForUpload: () => 'owner-1',
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const BASE: BaseParaKit = {
  codigoPai: '00000010',
  titulo: 'Fita Adesiva Transparente 45mm',
  descricao: 'Fita de boa qualidade.',
  preco: 19.9,
  custo: 5.5,
  pesoGramas: 120,
  alturaCm: 10,
  larguraCm: 8,
  comprimentoCm: 3,
  fotoPath: null,
  estoque: 30,
  categoriaMlId: 'MLB1000',
  origem: 'nacional',
  categoriaNome: 'Fitas Adesivas',
};

function kit(multiplicador: number, status: KitVinculado['status'], criadoEm: string, overrides: Partial<KitVinculado> = {}): KitVinculado {
  return {
    familiaId: `fam-${multiplicador}-${status}-${criadoEm}`,
    codigoPai: BASE.codigoPai,
    multiplicador,
    status,
    mlPermalink: null,
    mlItemId: null,
    criadoEm,
    ...overrides,
  };
}

function renderDialog(kitsExistentes: KitVinculado[], base: BaseParaKit = BASE, baseNoMl = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <DialogCriarKit
        familiaBaseId="familia-base-1"
        base={base}
        kitsExistentes={kitsExistentes}
        open
        baseNoMl={baseNoMl}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

// Foto já salva na base: dispensa escolher arquivo novo, então `podeCriar` fica true sem
// interagir com CampoFoto (fora do escopo deste teste).
const BASE_COM_FOTO: BaseParaKit = { ...BASE, fotoPath: 'org-1/produtos/foto.jpg' };

async function avancarECriar() {
  await userEvent.click(screen.getByLabelText('Kit de 2 unidades'));
  await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
  // O botão só habilita depois que o "Você recebe" de cada kit fica pronto.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Criar e publicar' }));
}

describe('DialogCriarKit — botão Reenviar (I-1)', () => {
  it('só aparece para o tamanho com status erro; os outros ficam "já criado" sem o botão', () => {
    renderDialog([
      kit(2, 'erro', '2026-08-01T00:00:00Z'),
      kit(3, 'pronto', '2026-08-01T00:00:00Z'),
    ]);

    expect(screen.getByRole('button', { name: /Reenviar/i })).toBeInTheDocument();

    const checkbox3 = screen.getByLabelText('Kit de 3 unidades');
    expect(checkbox3).toBeDisabled();
    expect(screen.getByText('já criado')).toBeInTheDocument();
    expect(screen.getByText('falhou ao publicar')).toBeInTheDocument();
  });

  it('clicar em Reenviar chama publicarFamilias com o familiaId do kit em erro', async () => {
    publicarFamiliasMock.mockResolvedValue({ enfileiradas: 1 });
    const erro = kit(4, 'erro', '2026-08-01T00:00:00Z');
    renderDialog([erro]);

    await userEvent.click(screen.getByRole('button', { name: /Reenviar/i }));

    await waitFor(() => expect(publicarFamiliasMock).toHaveBeenCalledWith([erro.familiaId]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Kit reenviado para publicação'));
  });

  it('enfileiradas === 0 mostra o aviso de falso-positivo, não o toast de sucesso', async () => {
    publicarFamiliasMock.mockResolvedValue({ enfileiradas: 0 });
    const erro = kit(5, 'erro', '2026-08-01T00:00:00Z');
    renderDialog([erro]);

    await userEvent.click(screen.getByRole('button', { name: /Reenviar/i }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Kit não foi reenviado',
      expect.objectContaining({ description: expect.stringContaining('Nenhuma família foi enfileirada') }),
    ));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('dedupe: com duas linhas do mesmo multiplicador, só a mais recente por criadoEm decide o botão', () => {
    // Mais recente (pronto) deve vencer a mais antiga (erro) — sem Reenviar pra esse tamanho.
    renderDialog([
      kit(6, 'pronto', '2026-08-02T00:00:00Z', { familiaId: 'fam-mais-recente' }),
      kit(6, 'erro', '2026-08-01T00:00:00Z', { familiaId: 'fam-mais-antiga' }),
    ]);

    expect(screen.queryByRole('button', { name: /Reenviar/i })).not.toBeInTheDocument();
    expect(screen.getByText('já criado')).toBeInTheDocument();
    expect(screen.queryByText('falhou ao publicar')).not.toBeInTheDocument();
  });
});

// ADR-0151 (item 14): kit não passa pela Revisão (D-2/D-4) — o preview É a revisão e confirmar
// publica direto. O rótulo e o aviso deixam isso explícito ANTES do clique, pra não repetir a
// surpresa do operador.
describe('DialogCriarKit — etapa de preview deixa explícito que publica direto', () => {
  it('botão de confirmação diz "Criar e publicar" e o aviso de publicação direta aparece', async () => {
    renderDialog([], BASE_COM_FOTO);

    await userEvent.click(screen.getByLabelText('Kit de 2 unidades'));
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));

    expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeInTheDocument();
    expect(screen.getByText('O kit vai direto para o Mercado Livre — esta tela é a revisão.')).toBeInTheDocument();
  });

  it('etapa de tamanhos não mostra o aviso de publicação direta', () => {
    renderDialog([]);
    expect(screen.queryByText('O kit vai direto para o Mercado Livre — esta tela é a revisão.')).not.toBeInTheDocument();
  });
});

describe('DialogCriarKit — conta do "Você recebe" trava a criação', () => {
  it('com 2 tamanhos e um em prejuízo não confirmado, "Criar e publicar" fica desabilitado até confirmar', async () => {
    renderDialog([], BASE_COM_FOTO);
    await userEvent.click(screen.getByLabelText('Kit de 2 unidades'));
    await userEvent.click(screen.getByLabelText('Kit de 3 unidades'));
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeEnabled());

    // Kit de 3: custo 16,50; preço 20 -> recebe ~6 -> prejuízo.
    const preco3 = screen.getByLabelText('Preço do kit 3');
    await userEvent.clear(preco3);
    await userEvent.type(preco3, '20');
    await waitFor(() => expect(screen.getByLabelText('Seguir mesmo assim, kit de 3 unidades')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Seguir mesmo assim, kit de 3 unidades'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeEnabled());
  });
});

describe('DialogCriarKit — toast pós-criação com link pro relatório', () => {
  it('sucesso com loteId: toast tem action "Acompanhar" que navega para o relatório', async () => {
    criarKitVinculadoMock.mockResolvedValue({
      ok: true,
      kits: [{ familiaId: 'fam-novo', codigoPai: '00000020', codigo: '00000021', multiplicador: 2 }],
      publicacaoOk: true,
      loteId: 'lote-123',
    });
    renderDialog([], BASE_COM_FOTO);

    await avancarECriar();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'Kit criado e enviado para publicação',
      expect.objectContaining({
        description: 'Acompanhe o andamento no relatório.',
        action: expect.objectContaining({ label: 'Acompanhar' }),
      }),
    ));
    const opcoes = vi.mocked(toast.success).mock.calls[0][1] as { action?: { onClick: () => void } };
    opcoes.action!.onClick();
    expect(navigateMock).toHaveBeenCalledWith('/relatorio/lote-123');
  });

  it('sucesso sem loteId: toast sem action e nenhuma navegação', async () => {
    criarKitVinculadoMock.mockResolvedValue({
      ok: true,
      kits: [{ familiaId: 'fam-existente', codigoPai: '00000020', codigo: '00000021', multiplicador: 2 }],
      publicacaoOk: true,
    });
    renderDialog([], BASE_COM_FOTO);

    await avancarECriar();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'Kit criado e enviado para publicação',
      expect.objectContaining({ description: 'Acompanhe o andamento no relatório.' }),
    ));
    const opcoes = vi.mocked(toast.success).mock.calls[0][1] as { action?: unknown };
    expect(opcoes.action).toBeUndefined();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('Trocar categoria', () => {
  it('botão "Trocar categoria" abre a busca; escolher uma categoria mostra o chip e entra no payload', async () => {
    buscarCategoriaMLMock.mockResolvedValue({
      candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainName: '' }],
      sugestaoConcorrente: null,
    });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true, loteId: null });
    renderDialog([], BASE_COM_FOTO);

    await userEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
    await userEvent.type(screen.getByPlaceholderText(/buscar categoria/i), 'leite infantil');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(screen.getByText('Leite Infantil')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Leite Infantil'));

    expect(screen.getByText('Categoria do kit:')).toBeInTheDocument();
    expect(screen.getByText('Leite Infantil')).toBeInTheDocument();
    expect(buscarCategoriaMLMock).toHaveBeenCalledWith('familia-base-1', 'leite infantil');

    await avancarECriar();

    await waitFor(() => expect(criarKitVinculadoMock).toHaveBeenCalled());
    const chamada = criarKitVinculadoMock.mock.calls[0][0] as { categoriaOverride?: unknown };
    expect(chamada.categoriaOverride).toEqual({ categoriaMlId: 'MLB999', categoriaNome: 'Leite Infantil' });
  });

  it('"×" no chip remove o override — volta a herdar a categoria da base', async () => {
    buscarCategoriaMLMock.mockResolvedValue({
      candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainName: '' }],
      sugestaoConcorrente: null,
    });
    renderDialog([], BASE_COM_FOTO);
    await userEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
    await userEvent.type(screen.getByPlaceholderText(/buscar categoria/i), 'leite');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => screen.getByText('Leite Infantil'));
    await userEvent.click(screen.getByText('Leite Infantil'));
    expect(screen.getByText('Categoria do kit:')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remover categoria escolhida' }));
    expect(screen.queryByText('Categoria do kit:')).not.toBeInTheDocument();
    expect(screen.queryByText('Leite Infantil')).not.toBeInTheDocument();
  });

  it('mostra o caminho completo da categoria da base e o de cada candidato da busca', async () => {
    caminhoCategoriaMLMock.mockImplementation(async (id: string) => (
      id === 'MLB1000'
        ? ['Casa, Móveis e Decoração', 'Materiais de Escritório', 'Fitas Adesivas']
        : ['Alimentos e Bebidas', 'Mercearia', 'Leite Infantil']
    ));
    buscarCategoriaMLMock.mockResolvedValue({
      candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainName: '' }],
      sugestaoConcorrente: null,
    });
    renderDialog([], BASE_COM_FOTO);

    // Cenário 1: a categoria em que o produto-base está hoje, com o caminho inteiro.
    expect(screen.getByText('Categoria do produto:')).toBeInTheDocument();
    await waitFor(() => expect(
      screen.getByText(/Casa, Móveis e Decoração › Materiais de Escritório/),
    ).toBeInTheDocument());

    // Cenário 2: cada resultado da busca também com o caminho inteiro.
    await userEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
    await userEvent.type(screen.getByPlaceholderText(/buscar categoria/i), 'leite infantil');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(
      screen.getByText(/Alimentos e Bebidas › Mercearia/),
    ).toBeInTheDocument());
  });

  it('sem categoria definida na base, avisa em vez de mostrar linha vazia', async () => {
    renderDialog([], { ...BASE_COM_FOTO, categoriaMlId: null, categoriaNome: null });
    expect(screen.getByText('ainda não definida')).toBeInTheDocument();
  });
});

// Pedido do Diego (2026-09-10): "Criando…" no botão não deixa claro que ALGO está acontecendo —
// a publicação leva vários segundos num diálogo grande e parece travado. O diálogo inteiro ganha a
// aura do GlowEffect ("card mode") enquanto a criação está em voo, e a perde ao terminar.
describe('DialogCriarKit — sinal de que está processando', () => {
  function dialogo() {
    return document.querySelector('[data-slot="dialog-content"]')!;
  }

  it('a aura só existe enquanto a criação está em voo, e o diálogo fica aria-busy', async () => {
    let concluir!: (v: unknown) => void;
    criarKitVinculadoMock.mockReturnValue(new Promise((res) => { concluir = res; }));
    renderDialog([], BASE_COM_FOTO);

    expect(dialogo()).not.toHaveClass('glow-effect-sombra');
    expect(dialogo()).toHaveAttribute('aria-busy', 'false');

    await avancarECriar();

    await waitFor(() => expect(dialogo()).toHaveClass('glow-effect-sombra'));
    expect(dialogo()).toHaveAttribute('aria-busy', 'true');

    concluir({ ok: true, kits: [], publicacaoOk: true, loteId: null });
    await waitFor(() => expect(criarKitVinculadoMock).toHaveBeenCalled());
  });

  it('falha na criação tira a aura — o diálogo não fica brilhando para sempre', async () => {
    criarKitVinculadoMock.mockRejectedValue(new Error('boom'));
    renderDialog([], BASE_COM_FOTO);

    await avancarECriar();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(dialogo()).not.toHaveClass('glow-effect-sombra');
    expect(dialogo()).toHaveAttribute('aria-busy', 'false');
  });
});

// ADR-0204: galeria da base (fotos 2 a 7) no preview. Lida uma vez por categoria; escolha por tamanho.
describe('DialogCriarKit — galeria da base (ADR-0204)', () => {
  const FOTOS = {
    fotos: [
      { id: 'f2', item: 'MLB1', url: 'https://x.test/2.jpg' },
      { id: 'f3', item: 'MLB1', url: 'https://x.test/3.jpg' },
    ],
    avisos: [], indisponivel: false, limite: 7,
  };
  const kitsEnviados = () => (criarKitVinculadoMock.mock.calls[0][0] as { kits: Array<{ galeria?: string[] }> }).kits;

  async function irAoPreview() {
    await userEvent.click(screen.getByLabelText('Kit de 2 unidades'));
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
  }
  async function criar() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Criar e publicar' }));
    await waitFor(() => expect(criarKitVinculadoMock).toHaveBeenCalled());
  }

  it('lista as fotos numeradas e envia os ids no pedido', async () => {
    invokeMock.mockResolvedValue({ data: FOTOS, error: null });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true });
    renderDialog([], BASE_COM_FOTO, true);
    await irAoPreview();
    await screen.findByText(/Fotos 2 a 7 do anúncio principal/);
    expect(invokeMock).toHaveBeenCalledWith('fotos-base-kit', { body: { familia_base_id: 'familia-base-1', categoria_ml_id: 'MLB1000' } });
    await criar();
    expect(kitsEnviados()[0].galeria).toEqual(['f2', 'f3']);
  });

  it('remover foto tira o id do pedido', async () => {
    invokeMock.mockResolvedValue({ data: FOTOS, error: null });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true });
    renderDialog([], BASE_COM_FOTO, true);
    await irAoPreview();
    await userEvent.click(await screen.findByRole('button', { name: /Remover foto 2/ }));
    await criar();
    expect(kitsEnviados()[0].galeria).toEqual(['f3']);
  });

  it('"Só a foto do kit" envia lista vazia', async () => {
    invokeMock.mockResolvedValue({ data: FOTOS, error: null });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true });
    renderDialog([], BASE_COM_FOTO, true);
    await irAoPreview();
    await userEvent.click(await screen.findByRole('switch', { name: 'Só a foto do kit (kit de 2 unidades)' }));
    await criar();
    expect(kitsEnviados()[0].galeria).toEqual([]);
  });

  it('falha na leitura segue só com a capa', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('boom') });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true });
    renderDialog([], BASE_COM_FOTO, true);
    await irAoPreview();
    await screen.findByText(/sai só com a capa/);
    await criar();
    expect(kitsEnviados()[0].galeria).toBeUndefined();
  });

  it('bloqueia "Criar e publicar" durante a leitura', async () => {
    let resolver: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(new Promise((r) => { resolver = r; }));
    renderDialog([], BASE_COM_FOTO, true);
    await irAoPreview();
    await screen.findByText(/Lendo as fotos/);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeDisabled();
    resolver({ data: FOTOS, error: null });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeEnabled());
  });

  it('trocar a categoria refaz a leitura', async () => {
    invokeMock.mockResolvedValue({ data: FOTOS, error: null });
    buscarCategoriaMLMock.mockResolvedValue({ candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite Infantil', domainName: '' }], sugestaoConcorrente: null });
    renderDialog([], BASE_COM_FOTO, true);
    await userEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
    await userEvent.type(screen.getByPlaceholderText(/buscar categoria/i), 'leite');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await userEvent.click(await screen.findByText('Leite Infantil'));
    await irAoPreview();
    await screen.findByText(/Fotos 2 a 7 do anúncio principal/);
    expect(invokeMock).toHaveBeenCalledWith('fotos-base-kit', { body: { familia_base_id: 'familia-base-1', categoria_ml_id: 'MLB999' } });
  });

  it('nome acessível dos controles inclui o tamanho do kit', async () => {
    invokeMock.mockResolvedValue({ data: FOTOS, error: null });
    renderDialog([], BASE_COM_FOTO, true);
    await userEvent.click(screen.getByLabelText('Kit de 2 unidades'));
    await userEvent.click(screen.getByLabelText('Kit de 3 unidades'));
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(await screen.findByRole('switch', { name: 'Só a foto do kit (kit de 3 unidades)' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Só a foto do kit (kit de 2 unidades)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover foto 2 (Base) (kit de 3 unidades)' })).toBeInTheDocument();
  });

  it('base não publicada: não chama a edge', async () => {
    renderDialog([], BASE_COM_FOTO, false);
    await irAoPreview();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeEnabled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.getByText('A base ainda não foi publicada: o kit sai só com a capa')).toBeInTheDocument();
    expect(screen.queryByText(/Fotos 2 a 7/)).not.toBeInTheDocument();
  });

  it('resposta com avisos mostra o aviso de kit só com a capa', async () => {
    invokeMock.mockResolvedValue({ data: FOTOS, error: null });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true, avisos: ['Galeria da base não lida.'] });
    renderDialog([], BASE_COM_FOTO, true);
    await irAoPreview();
    await screen.findByText(/Fotos 2 a 7 do anúncio principal/);
    await criar();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'O kit foi criado só com a capa',
      expect.objectContaining({ description: 'Galeria da base não lida.' }),
    ));
    expect(toast.success).toHaveBeenCalled();
  });

  it('resposta sem avisos não mostra o aviso', async () => {
    invokeMock.mockResolvedValue({ data: FOTOS, error: null });
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true });
    renderDialog([], BASE_COM_FOTO, true);
    await irAoPreview();
    await screen.findByText(/Fotos 2 a 7 do anúncio principal/);
    await criar();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

// ADR-0205 (Task 4): capa com N unidades por IA. O estado vive no dialog; só "Usar esta foto" grava imagemPath.
describe('DialogCriarKit — capa com N unidades (ADR-0205)', () => {
  const aprovada = (id: string) => ({
    ok: true as const, aprovado: true, proxima: false, path: `ORG/kit-variacao-ia/${id}.png`,
    url: `https://x/${id}.png`, verificacao: { aprovado: true, itens: [], motivos: [] },
  });
  const botaoGerar = () => screen.queryByRole('button', { name: 'Gerar capa com 2 unidades' });
  async function abrirPreview(base: BaseParaKit = BASE_COM_FOTO) {
    renderDialog([], base);
    await userEvent.click(screen.getByLabelText('Kit de 2 unidades'));
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await screen.findByRole('button', { name: 'Criar e publicar' });
  }
  const imagemPathEnviado = () => (criarKitVinculadoMock.mock.calls[0][0] as { kits: Array<{ imagemPath: string | null }> }).kits[0].imagemPath;
  async function criar() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar e publicar' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Criar e publicar' }));
    await waitFor(() => expect(criarKitVinculadoMock).toHaveBeenCalled());
  }

  beforeEach(() => {
    modulosMock.data = ['imagem_ia'];
    gerarCapaMock.mockReset();
    uploadFileMock.mockReset();
    uploadFileMock.mockResolvedValue('owner-1/kit-x/manual.png');
    // jsdom não tem createObjectURL (CampoFoto mostra a miniatura do arquivo escolhido).
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    criarKitVinculadoMock.mockResolvedValue({ ok: true, kits: [], publicacaoOk: true, loteId: null });
  });

  it('botão só aparece com capa na base e módulo imagem_ia', async () => {
    await abrirPreview(BASE);
    expect(botaoGerar()).toBeNull();
    cleanup();
    modulosMock.data = [];
    await abrirPreview();
    expect(botaoGerar()).toBeNull();
    cleanup();
    modulosMock.data = ['imagem_ia'];
    await abrirPreview();
    expect(botaoGerar()).toBeInTheDocument();
  });

  it('gerar não altera a foto; "Usar esta foto" aplica o path e o kit sai com ele (sem upload)', async () => {
    gerarCapaMock.mockResolvedValue(aprovada('r1'));
    await abrirPreview();
    await userEvent.click(botaoGerar()!);
    const usar = await screen.findByRole('button', { name: 'Usar capa com 2 unidades' });
    fireEvent.load(screen.getByAltText('Capa gerada com 2 unidades'));
    await userEvent.click(usar);
    await criar();
    expect(imagemPathEnviado()).toBe('ORG/kit-variacao-ia/r1.png');
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('sem clicar em "Usar", a candidata não vai para o kit', async () => {
    gerarCapaMock.mockResolvedValue(aprovada('r1'));
    await abrirPreview();
    await userEvent.click(botaoGerar()!);
    await screen.findByRole('button', { name: 'Usar capa com 2 unidades' });
    await criar();
    expect(imagemPathEnviado()).toBe(BASE_COM_FOTO.fotoPath);
  });

  it('arquivo manual descarta a candidata e repõe a foto da base (mesmo depois de "Usar")', async () => {
    gerarCapaMock.mockResolvedValue(aprovada('r1'));
    await abrirPreview();
    await userEvent.click(botaoGerar()!);
    const usar = await screen.findByRole('button', { name: 'Usar capa com 2 unidades' });
    fireEvent.load(screen.getByAltText('Capa gerada com 2 unidades'));
    await userEvent.click(usar);
    // imagemPath virou o path gerado: o preview passa a ler a foto dele.
    await waitFor(() => expect(signedPaths).toContain('ORG/kit-variacao-ia/r1.png'));
    await userEvent.upload(screen.getByLabelText('Foto do kit 2'), new File(['x'], 'manual.png', { type: 'image/png' }));
    // Remover o arquivo deixa só o imagemPath: tem de ser o da base, não o gerado.
    await userEvent.click(await screen.findByRole('button', { name: 'Remover Foto do kit 2' }));
    await criar();
    expect(imagemPathEnviado()).toBe(BASE_COM_FOTO.fotoPath);
  });

  it('arquivo manual com candidata pendente a descarta', async () => {
    gerarCapaMock.mockResolvedValue(aprovada('r1'));
    await abrirPreview();
    await userEvent.click(botaoGerar()!);
    await screen.findByRole('button', { name: 'Usar capa com 2 unidades' });
    await userEvent.upload(screen.getByLabelText('Foto do kit 2'), new File(['x'], 'manual.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Usar capa com 2 unidades' })).toBeNull());
    expect(botaoGerar()).toBeInTheDocument();
  });

  it('Voltar durante a geração não perde a candidata ao reabrir a etapa', async () => {
    let fim!: (v: unknown) => void;
    gerarCapaMock.mockReturnValue(new Promise((r) => { fim = r; }));
    await abrirPreview();
    await userEvent.click(botaoGerar()!);
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await act(async () => { fim(aprovada('r2')); });
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(await screen.findByRole('button', { name: 'Usar capa com 2 unidades' })).toBeInTheDocument();
  });
});
