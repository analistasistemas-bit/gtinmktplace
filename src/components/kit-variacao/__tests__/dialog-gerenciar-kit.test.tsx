import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogGerenciarKit } from '../dialog-gerenciar-kit';
import { adicionarAoKitEdge, enviarFotoKit, gerarFotoKitEdge, gerenciarKitEdge, type KitVariacaoResumo } from '@/lib/kit-variacao-edge';

const detalhe = {
  data: {
    skus: [
      { codigo: 'KPB-M', tamanho: 'M', rotulo: 'Preto e Branco', cores: ['Preto', 'Branco'], saldo: 2,
        componentes: [{ codigo: 'P-M', quantidade: 1 }, { codigo: 'B-M', quantidade: 1 }] },
      { codigo: 'KPB-G', tamanho: 'G', rotulo: 'Preto e Branco', cores: ['Preto', 'Branco'], saldo: 0,
        componentes: [{ codigo: 'P-G', quantidade: 1 }, { codigo: 'B-G', quantidade: 1 }] },
    ],
    baseFamiliaId: 'FAM-BASE',
    abertas: [] as Array<{ id: string; tipo: string; estado: string; passo: string; alerta: string | null; criadoEm: string }>,
  },
  isLoading: false, isError: false,
};
// Preço avulso das peças (Preto em promoção até 20/11 em BRT 19/11; Branco sem promoção); mutável por teste.
const avulso = {
  data: new Map([
    ['P-GG', { normal: 71.9, promocao: 41.9, fimPromocao: '2026-11-20T02:59:00Z' }],
    ['B-GG', { normal: 59.9, promocao: null, fimPromocao: null }],
  ]) as Map<string, { normal: number | null; promocao: number | null; fimPromocao: string | null }> | undefined,
  isFetching: false, isError: false,
};
// Proposta de galeria das peças (ADR-0200, adendo 12/11); mutável por teste.
const galeria = {
  data: undefined as Record<string, { fotos: Array<{ id: string; item: string; url: string | null; cor: string }>; avisos: string[]; indisponivel: boolean }> | undefined,
  isPending: false, isError: false, fetchStatus: 'idle',
};
vi.mock('@/hooks/useKitsVariacao', () => ({
  useDetalheKitVariacao: () => detalhe, QK_KITS_VARIACAO: ['kits-variacao'], usePrecoAvulsoKit: () => avulso,
  useGaleriaPecasKit: () => galeria,
}));
vi.mock('@/lib/kit-variacao-edge', () => ({
  gerenciarKitEdge: vi.fn(async () => ({ ok: true })),
  adicionarAoKitEdge: vi.fn(async () => ({ ok: true })),
  enviarFotoKit: vi.fn(async (pasta: string, rotulo: string) => `ORG/${pasta}/${rotulo}.jpg`),
  gerarFotoKitEdge: vi.fn(async (p: { requestId: string }) => ({ ok: true, path: `ORG/kit-variacao-ia/${p.requestId}.png`, url: 'https://x/g.png' })),
}));
const modulos = { data: ['kit_variacao'] as string[] };
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulos }));
// Base: Preto, Branco e Marrom em M, G e GG. Preto M tem só 3 peças; Marrom GG está zerado (a cópia excluída não conta).
const peca = (codigo: string, cor: string, tamanho: string, estoque: number, excluidaDaPublicacao = false) => ({ codigo, cor, tamanho, estoque, excluidaDaPublicacao });
const base = {
  data: {
    variacoes: [
      peca('M-GG-OLD', 'Marrom', 'GG', 50, true),
      ...['M', 'G', 'GG'].flatMap((t) => [
        peca(`P-${t}`, 'Preto', t, t === 'M' ? 3 : 9), peca(`B-${t}`, 'Branco', t, 9), peca(`M-${t}`, 'Marrom', t, t === 'GG' ? 0 : 9),
      ]),
    ],
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => base }));

const kitBase: KitVariacaoResumo = {
  id: 'K1', codigoPaiBase: '0001', codigoPaiKit: '0002', pecasPorKit: 2, soEmKit: false, reposicaoAuto: false,
  meta: 3, versao: 7, status: 'publicado', preco: 89.9,
};

function abrir(kit: Partial<KitVariacaoResumo> = {}, isAdmin = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogGerenciarKit kit={{ ...kitBase, ...kit }} open onOpenChange={() => {}} isAdmin={isAdmin} />
    </QueryClientProvider>,
  );
}

describe('DialogGerenciarKit', () => {
  beforeEach(() => {
    vi.mocked(gerenciarKitEdge).mockClear();
    vi.mocked(adicionarAoKitEdge).mockClear();
    vi.mocked(enviarFotoKit).mockClear();
    detalhe.data.abertas = [];
    modulos.data = ['kit_variacao'];
  });

  it('mostra o saldo por combinação e tamanho', () => {
    abrir();
    expect(screen.getByLabelText('Saldo do kit Preto e Branco M')).toHaveTextContent('2');
    expect(screen.getByLabelText('Saldo do kit Preto e Branco G')).toHaveTextContent('0');
  });

  it('kit em erro avisa que a montagem travou; publicando avisa do seletor do ML', () => {
    const { unmount } = abrir({ status: 'erro' });
    expect(screen.getByText(/montagem deste kit travou/)).toBeInTheDocument();
    unmount();
    abrir({ status: 'publicando' });
    expect(screen.getByText(/seletor de combinação/)).toBeInTheDocument();
  });

  it('transferência aberta aparece com o alerta', () => {
    detalhe.data.abertas = [{ id: 'T1', tipo: 'montar', estado: 'travada', passo: 'aumentar', alerta: 'Leitura divergente', criadoEm: '2026-11-08T10:00:00Z' }];
    abrir();
    expect(screen.getByText(/Leitura divergente/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Montar mais' })).toBeDisabled();
  });

  it('montar mais envia só as quantidades digitadas, sem criar anúncio', async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '2');
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[0][0]).toMatchObject({
      kitId: 'K1', acao: 'montar', versao: 7, itens: [{ codigo: 'KPB-M', quantidade: 2 }], chave: expect.any(String),
    });
  });

  it('repetir o mesmo pedido depois de falha usa a mesma chave (a RPC devolve a transferência original)', async () => {
    const user = userEvent.setup();
    vi.mocked(gerenciarKitEdge).mockResolvedValueOnce({ ok: false, motivo: 'rede', mensagem: 'Failed to fetch' });
    abrir();
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '2');
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(2));
    const [a, b] = vi.mocked(gerenciarKitEdge).mock.calls.map((c) => c[0]);
    expect(b.chave).toBe(a.chave);
    // Pedido diferente = operação nova = chave nova.
    await user.clear(screen.getByLabelText('Quantidade Preto e Branco M'));
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(3));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[2][0].chave).not.toBe(a.chave);
  });

  it('a versão devolvida pela RPC vale para a operação seguinte', async () => {
    const user = userEvent.setup();
    vi.mocked(gerenciarKitEdge).mockResolvedValueOnce({ ok: true, versao: 8 });
    abrir({ soEmKit: true, reposicaoAuto: true });
    await user.clear(screen.getByLabelText('Meta'));
    await user.type(screen.getByLabelText('Meta'), '5');
    await user.click(screen.getByRole('button', { name: 'Salvar meta' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('switch', { name: 'Reposição automática' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(2));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[1][0]).toMatchObject({ acao: 'desligar_reposicao', versao: 8 });
  });

  it('desmontar além do saldo bloqueia', async () => {
    const user = userEvent.setup();
    abrir();
    await user.type(screen.getByLabelText('Quantidade Preto e Branco G'), '1');
    expect(screen.getByRole('button', { name: 'Desmontar' })).toBeDisabled();
  });

  it('desmontar com reposição ligada avisa que ela desliga; com "Vender só em kit" pergunta se quer desligar', async () => {
    const user = userEvent.setup();
    abrir({ soEmKit: true, reposicaoAuto: true });
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Desmontar' }));
    expect(screen.getByText(/reposição automática fica desligada até você religar/)).toBeInTheDocument();
    expect(screen.getByText(/voltam como guardadas, sem oferta/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Desligar também "Vender só em kit"/ }));
    await user.click(screen.getByRole('button', { name: 'Desmontar kits' }));
    // Uma chamada só, com a intenção: a RPC desliga a política antes de a transferência capturar a versão.
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[0][0]).toMatchObject({
      acao: 'desmontar', versao: 7, desligarSoEmKit: true, chave: expect.any(String), itens: [{ codigo: 'KPB-M', quantidade: 1 }],
    });
  });

  it('desligar "Vender só em kit" pede confirmação antes', async () => {
    const user = userEvent.setup();
    abrir({ soEmKit: true, reposicaoAuto: true });
    await user.click(screen.getByRole('switch', { name: 'Vender só em kit' }));
    expect(gerenciarKitEdge).not.toHaveBeenCalled();
    expect(within(screen.getByRole('alertdialog')).getByText(/reativa os anúncios individuais/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desligar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[0][0]).toMatchObject({ kitId: 'K1', acao: 'desligar_so_em_kit', versao: 7 });
  });

  it('alterar a meta envia a versão lida', async () => {
    const user = userEvent.setup();
    abrir({ soEmKit: true, reposicaoAuto: true });
    await user.clear(screen.getByLabelText('Meta'));
    await user.type(screen.getByLabelText('Meta'), '5');
    await user.click(screen.getByRole('button', { name: 'Salvar meta' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[0][0]).toMatchObject({ kitId: 'K1', acao: 'alterar_meta', versao: 7, meta: 5 });
  });

  it('quem não é admin só vê o saldo', () => {
    abrir({ soEmKit: true }, false);
    expect(screen.queryByRole('switch', { name: 'Vender só em kit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Montar mais' })).toBeNull();
    expect(screen.getByLabelText('Saldo do kit Preto e Branco M')).toHaveTextContent('2');
  });

  describe('Montar mais com combinação ou tamanho novo', () => {
    async function abrirNovo(user: ReturnType<typeof userEvent.setup>) {
      abrir();
      await user.click(screen.getByRole('button', { name: /Combinação ou tamanho novo/ }));
    }

    it('combinação nunca publicada exige foto própria e vai para a criação de SKU no mesmo kit', async () => {
      const user = userEvent.setup();
      await abrirNovo(user);
      expect(screen.queryByLabelText('Nova Preto e Branco M')).toBeNull();   // já publicada: só pela tabela
      await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
      await user.type(screen.getByLabelText('Nova Preto e Marrom M'), '2');
      expect(screen.getByRole('button', { name: 'Montar mais' })).toBeDisabled();
      expect(screen.getByText(/Envie a foto de cada combinação nova/)).toBeInTheDocument();

      await user.upload(screen.getByLabelText('Foto Preto e Marrom'), new File(['x'], 'pm.jpg', { type: 'image/jpeg' }));
      await user.click(screen.getByRole('button', { name: 'Montar mais' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent(/1 anúncio novo \(combinação ou tamanho\)/);
      await user.click(screen.getByRole('button', { name: 'Montar' }));
      await waitFor(() => expect(adicionarAoKitEdge).toHaveBeenCalledTimes(1));
      const chamada = vi.mocked(adicionarAoKitEdge).mock.calls[0][0];
      expect(chamada).toMatchObject({
        kitId: 'K1', versao: 7,
        quantidades: [
          { cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 1 },
          { cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 2 },
        ],
        fotos: { 'Preto e Marrom': expect.stringContaining('Preto e Marrom') },
      });
      expect(chamada.chaveCadastro).toBeTruthy();
      expect(gerenciarKitEdge).not.toHaveBeenCalled();
    });

    it('combinação nova com galeria das peças: prévia, remover e o pedido leva só o que foi mantido', async () => {
      galeria.data = {
        'Preto e Marrom': {
          fotos: [
            { id: 'P2', item: 'MLB-P', url: 'https://x/P2.jpg', cor: 'Preto' },
            { id: 'M3', item: 'MLB-M', url: 'https://x/M3.jpg', cor: 'Marrom' },
          ],
          avisos: [], indisponivel: false,
        },
      };
      try {
        const user = userEvent.setup();
        await abrirNovo(user);
        await user.type(screen.getByLabelText('Nova Preto e Marrom M'), '2');
        await user.upload(screen.getByLabelText('Foto Preto e Marrom'), new File(['x'], 'pm.jpg', { type: 'image/jpeg' }));
        expect(await screen.findByRole('list', { name: 'Fotos das peças no anúncio' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Remover foto 3 (Marrom)' }));
        await user.click(screen.getByRole('button', { name: 'Montar mais' }));
        await user.click(screen.getByRole('button', { name: 'Montar' }));
        await waitFor(() => expect(adicionarAoKitEdge).toHaveBeenCalledTimes(1));
        expect(vi.mocked(adicionarAoKitEdge).mock.calls[0][0].galeria).toEqual({ 'Preto e Marrom': ['P2'] });
      } finally {
        galeria.data = undefined;
      }
    });

    it('sem proposta de galeria (leitura indisponível) o pedido segue sem galeria', async () => {
      const user = userEvent.setup();
      await abrirNovo(user);
      await user.type(screen.getByLabelText('Nova Preto e Marrom M'), '1');
      await user.upload(screen.getByLabelText('Foto Preto e Marrom'), new File(['x'], 'pm.jpg', { type: 'image/jpeg' }));
      await user.click(screen.getByRole('button', { name: 'Montar mais' }));
      await user.click(screen.getByRole('button', { name: 'Montar' }));
      await waitFor(() => expect(adicionarAoKitEdge).toHaveBeenCalledTimes(1));
      expect(vi.mocked(adicionarAoKitEdge).mock.calls[0][0].galeria).toBeUndefined();
    });

    it('com imagem_ia, a combinação nova pode usar foto gerada, só depois de aprovada', async () => {
      modulos.data = ['kit_variacao', 'imagem_ia'];
      const user = userEvent.setup();
      await abrirNovo(user);
      await user.type(screen.getByLabelText('Nova Preto e Marrom M'), '1');
      await user.click(screen.getByRole('button', { name: 'Gerar foto Preto e Marrom' }));
      await screen.findByRole('img', { name: 'Foto gerada Preto e Marrom' });
      expect(vi.mocked(gerarFotoKitEdge).mock.calls.at(-1)![0]).toMatchObject({ familiaBaseId: 'FAM-BASE', cores: ['Preto', 'Marrom'] });
      expect(screen.getByRole('button', { name: 'Montar mais' })).toBeDisabled();
      fireEvent.load(screen.getByRole('img', { name: 'Foto gerada Preto e Marrom' }));
      await user.click(screen.getByRole('button', { name: 'Usar foto gerada Preto e Marrom' }));
      await user.click(screen.getByRole('button', { name: 'Montar mais' }));
      await user.click(screen.getByRole('button', { name: 'Montar' }));
      await waitFor(() => expect(adicionarAoKitEdge).toHaveBeenCalledTimes(1));
      expect(vi.mocked(adicionarAoKitEdge).mock.calls[0][0].fotos['Preto e Marrom']).toMatch(/^ORG\/kit-variacao-ia\//);
      expect(enviarFotoKit).not.toHaveBeenCalled();
    });

    it('tamanho novo de combinação publicada usa a foto dela (sem envio)', async () => {
      const user = userEvent.setup();
      await abrirNovo(user);
      await user.type(screen.getByLabelText('Nova Preto e Branco GG'), '1');
      expect(screen.queryByLabelText('Foto Preto e Branco')).toBeNull();
      expect(screen.getByRole('button', { name: 'Montar mais' })).toBeEnabled();
    });

    it('cada célula nova mostra o máximo, que cai com o que Montar mais já usa da mesma cor', async () => {
      const user = userEvent.setup();
      await abrirNovo(user);
      expect(screen.getByLabelText('Máximo nova Preto e Marrom M')).toHaveTextContent('máx 3');
      expect(screen.getByLabelText('Máximo montar Preto e Branco M')).toHaveTextContent('monta até 3');
      await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '2');
      expect(screen.getByLabelText('Máximo nova Preto e Marrom M')).toHaveTextContent('máx 1');
      await user.type(screen.getByLabelText('Nova Preto e Marrom M'), '1');
      expect(screen.getByLabelText('Máximo montar Preto e Branco M')).toHaveTextContent('monta até 2');
    });

    it('célula nova com máximo 0 fica desabilitada e diz qual cor falta; a cópia excluída não conta', async () => {
      const user = userEvent.setup();
      await abrirNovo(user);
      const campo = screen.getByLabelText('Nova Preto e Marrom GG');
      expect(campo).toBeDisabled();
      expect(campo.closest('td')).toHaveAttribute('title', 'Sem peça livre de Marrom em GG');
      expect(screen.getByLabelText('Nova Preto e Branco GG')).toBeEnabled();
    });

    it('célula nova acima do máximo fica vermelha', async () => {
      const user = userEvent.setup();
      await abrirNovo(user);
      const campo = screen.getByLabelText('Nova Preto e Marrom M');
      await user.type(campo, '4');
      expect(campo).toHaveAttribute('aria-invalid', 'true');
      expect(campo.className).toMatch(/text-danger/);
    });

    it('antes de montar confere as peças da base: falta avisa e bloqueia', async () => {
      const user = userEvent.setup();
      await abrirNovo(user);
      await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '2');
      await user.type(screen.getByLabelText('Nova Preto e Marrom M'), '2');
      await user.upload(screen.getByLabelText('Foto Preto e Marrom'), new File(['x'], 'pm.jpg', { type: 'image/jpeg' }));
      // Preto M: 2 (Preto e Branco) + 2 (Preto e Marrom) = 4, há 3.
      expect(screen.getByText(/Preto M: precisa 4, há 3/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Montar mais' })).toBeDisabled();
    });
  });

  it('combinação nova: referência do preço avulso e aviso quando o preço do kit passa da soma em promoção', async () => {
    const user = userEvent.setup();
    abrir({ preco: 120 });
    await user.click(screen.getByRole('button', { name: /Combinação ou tamanho novo/ }));
    await user.type(screen.getByLabelText('Nova Preto e Branco GG'), '1');
    expect(screen.getByText(/Avulso \(2 peças, Preto e Branco · GG\)/)).toHaveTextContent('R$ 131,80 normal · R$ 101,80 em promoção');
    expect(screen.getByText(/O kit sai mais caro que comprar as 2 peças avulsas na promoção atual \(R\$ 101,80\)/)).toBeInTheDocument();
    expect(screen.getByText('A promoção da peça termina em 19/11. Depois disso a comparação muda.')).toBeInTheDocument();
  });

  it('Desmontar usa só as combinações publicadas: a matriz nova não habilita nem entra no total', async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByRole('button', { name: /Combinação ou tamanho novo/ }));
    await user.type(screen.getByLabelText('Nova Preto e Branco GG'), '3');
    expect(screen.getByRole('button', { name: 'Desmontar' })).toBeDisabled();
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Desmontar' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Desmontar 1 kit?');
  });

  it('resposta perdida → releitura 8 → repetição → a ação seguinte usa a versão autoritativa (sem presumir +1)', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (versao: number) => (
      <QueryClientProvider client={qc}>
        <DialogGerenciarKit kit={{ ...kitBase, versao }} open onOpenChange={() => {}} isAdmin />
      </QueryClientProvider>
    );
    // 1ª: a RPC gravou (versão 7 → 8), mas a resposta se perdeu.
    vi.mocked(gerenciarKitEdge).mockResolvedValueOnce({ ok: false, motivo: 'rede', mensagem: 'Failed to fetch' });
    const r = render(ui(7));
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '2');
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    // Releitura: o kit chega com a versão 8.
    r.rerender(ui(8));
    // Repetição: a RPC devolve a transferência original e a versão autoritativa (8, sem incremento).
    vi.mocked(gerenciarKitEdge).mockResolvedValueOnce({ ok: true, existente: true, transferenciaId: 'T1', versao: 8 });
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(2));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[1][0]).toMatchObject({ versao: 8, chave: vi.mocked(gerenciarKitEdge).mock.calls[0][0].chave });
    // Ação seguinte: vai com 8 (a RPC aceitaria), não 9.
    await user.clear(screen.getByLabelText('Meta'));
    await user.type(screen.getByLabelText('Meta'), '5');
    await user.click(screen.getByRole('button', { name: 'Salvar meta' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(3));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[2][0]).toMatchObject({ acao: 'alterar_meta', versao: 8 });
  });

  it('resposta de sucesso sem versão não incrementa por conta própria', async () => {
    const user = userEvent.setup();
    vi.mocked(gerenciarKitEdge).mockResolvedValueOnce({ ok: true });
    abrir({ soEmKit: true, reposicaoAuto: true });
    await user.clear(screen.getByLabelText('Meta'));
    await user.type(screen.getByLabelText('Meta'), '5');
    await user.click(screen.getByRole('button', { name: 'Salvar meta' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('switch', { name: 'Reposição automática' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(2));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[1][0]).toMatchObject({ versao: 7 });
  });

  describe('Encerrar kit', () => {
    const zerar = () => { for (const s of detalhe.data.skus) s.saldo = 0; };
    const restaurar = () => { detalhe.data.skus[0].saldo = 2; detalhe.data.skus[1].saldo = 0; };

    it('com saldo: "Desmonte antes", botão desabilitado e "Desmontar tudo" preenche o saldo inteiro', async () => {
      const user = userEvent.setup();
      abrir();
      expect(screen.getByRole('button', { name: 'Encerrar kit' })).toBeDisabled();
      expect(screen.getByText(/Desmonte antes/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Desmontar tudo' }));
      expect(screen.getByRole('heading', { name: 'Desmontar 2 kits?' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Desmontar kits' }));
      await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledWith(expect.objectContaining({
        acao: 'desmontar', itens: [{ codigo: 'KPB-M', quantidade: 2 }],
      })));
    });

    it('saldo 0 e sem transferência: confirmação explícita e chama a edge com a versão lida', async () => {
      zerar();
      try {
        const user = userEvent.setup();
        abrir();
        await user.click(screen.getByRole('button', { name: 'Encerrar kit' }));
        expect(screen.getByText('Encerra os anúncios do kit no Mercado Livre. Não dá para desfazer.')).toBeInTheDocument();
        expect(gerenciarKitEdge).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Encerrar anúncios' }));
        await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledWith({ kitId: 'K1', acao: 'encerrar', versao: 7 }));
      } finally { restaurar(); }
    });

    it('transferência aberta bloqueia o encerramento', () => {
      zerar();
      try {
        detalhe.data.abertas = [{ id: 'T1', tipo: 'desmontar', estado: 'ativa', passo: 'aguardar', alerta: null, criadoEm: '2026-11-08T10:00:00Z' }];
        abrir();
        expect(screen.getByRole('button', { name: 'Encerrar kit' })).toBeDisabled();
      } finally { restaurar(); }
    });

    it('quem não é admin não vê a ação', () => {
      zerar();
      try {
        abrir({}, false);
        expect(screen.queryByRole('button', { name: 'Encerrar kit' })).not.toBeInTheDocument();
      } finally { restaurar(); }
    });

    it('encerrando mostra o andamento; encerrado fica só leitura, sem montar nem política', () => {
      detalhe.data.abertas = [{ id: 'T9', tipo: 'encerrar', estado: 'ativa', passo: 'fechar', alerta: 'encerramento pendente: MLB1', criadoEm: '2026-11-08T10:00:00Z' }];
      const { unmount } = abrir({ status: 'encerrando' });
      expect(screen.getByText('Encerramento')).toBeInTheDocument();
      expect(screen.getByText(/encerramento pendente: MLB1/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Montar mais' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Encerrar kit' })).not.toBeInTheDocument();
      unmount();
      detalhe.data.abertas = [];
      abrir({ status: 'encerrado' });
      expect(screen.getAllByText('Encerrado').length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Montar mais' })).not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Vender só em kit' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Quantidade Preto e Branco M')).not.toBeInTheDocument();
    });
  });
});
