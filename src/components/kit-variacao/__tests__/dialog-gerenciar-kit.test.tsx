import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogGerenciarKit } from '../dialog-gerenciar-kit';
import { gerenciarKitEdge, type KitVariacaoResumo } from '@/lib/kit-variacao-edge';

const detalhe = {
  data: {
    skus: [
      { codigo: 'KPB-M', tamanho: 'M', rotulo: 'Preto e Branco', cores: ['Preto', 'Branco'], saldo: 2 },
      { codigo: 'KPB-G', tamanho: 'G', rotulo: 'Preto e Branco', cores: ['Preto', 'Branco'], saldo: 0 },
    ],
    abertas: [] as Array<{ id: string; tipo: string; estado: string; passo: string; alerta: string | null; criadoEm: string }>,
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useKitsVariacao', () => ({ useDetalheKitVariacao: () => detalhe, QK_KITS_VARIACAO: ['kits-variacao'] }));
vi.mock('@/lib/kit-variacao-edge', () => ({ gerenciarKitEdge: vi.fn(async () => ({ ok: true })) }));

const kitBase: KitVariacaoResumo = {
  id: 'K1', codigoPaiBase: '0001', codigoPaiKit: '0002', pecasPorKit: 2, soEmKit: false, reposicaoAuto: false,
  meta: 3, versao: 7, status: 'publicado',
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
    detalhe.data.abertas = [];
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
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledWith({
      kitId: 'K1', acao: 'montar', versao: 7, itens: [{ codigo: 'KPB-M', quantidade: 2 }],
    }));
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
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(2));
    expect(vi.mocked(gerenciarKitEdge).mock.calls[0][0]).toMatchObject({ acao: 'desmontar', versao: 7 });
    expect(vi.mocked(gerenciarKitEdge).mock.calls[1][0]).toMatchObject({ acao: 'desligar_so_em_kit', versao: 8 });
  });

  it('desligar "Vender só em kit" pede confirmação antes', async () => {
    const user = userEvent.setup();
    abrir({ soEmKit: true, reposicaoAuto: true });
    await user.click(screen.getByRole('switch', { name: 'Vender só em kit' }));
    expect(gerenciarKitEdge).not.toHaveBeenCalled();
    expect(within(screen.getByRole('alertdialog')).getByText(/reativa os anúncios individuais/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desligar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledWith({ kitId: 'K1', acao: 'desligar_so_em_kit', versao: 7 }));
  });

  it('alterar a meta envia a versão lida', async () => {
    const user = userEvent.setup();
    abrir({ soEmKit: true, reposicaoAuto: true });
    await user.clear(screen.getByLabelText('Meta'));
    await user.type(screen.getByLabelText('Meta'), '5');
    await user.click(screen.getByRole('button', { name: 'Salvar meta' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledWith({ kitId: 'K1', acao: 'alterar_meta', versao: 7, meta: 5 }));
  });

  it('quem não é admin só vê o saldo', () => {
    abrir({ soEmKit: true }, false);
    expect(screen.queryByRole('switch', { name: 'Vender só em kit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Montar mais' })).toBeNull();
    expect(screen.getByLabelText('Saldo do kit Preto e Branco M')).toHaveTextContent('2');
  });
});
