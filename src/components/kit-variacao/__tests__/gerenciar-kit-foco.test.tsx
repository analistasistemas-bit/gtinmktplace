// ADR-0200 (adendo 08/11): montar mais e desmontar fecham o Gerenciar e pedem o foco na linha da base; a seção
// "Transferências em andamento" usa o mesmo indicador de Publicados.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogGerenciarKit } from '../dialog-gerenciar-kit';
import { gerenciarKitEdge, type KitVariacaoResumo } from '@/lib/kit-variacao-edge';
import { useFocoKitStore } from '@/stores/foco-kit-store';

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
vi.mock('@/hooks/useKitsVariacao', () => ({
  useDetalheKitVariacao: () => detalhe, QK_KITS_VARIACAO: ['kits-variacao'],
  usePrecoAvulsoKit: () => ({ data: undefined, isFetching: false, isError: true }),
  useGaleriaPecasKit: () => ({ data: undefined, isPending: false, isError: false, fetchStatus: 'idle' }),
}));
vi.mock('@/lib/kit-variacao-edge', () => ({
  gerenciarKitEdge: vi.fn(async () => ({ ok: true })),
  adicionarAoKitEdge: vi.fn(async () => ({ ok: true })),
  enviarFotoKit: vi.fn(async (pasta: string, rotulo: string) => `ORG/${pasta}/${rotulo}.jpg`),
  gerarFotoKitEdge: vi.fn(async (p: { requestId: string }) => ({ ok: true, path: `ORG/kit-variacao-ia/${p.requestId}.png`, url: 'https://x/g.png' })),
}));
const modulos = { data: ['kit_variacao'] as string[] };
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulos }));
// Base: Preto, Branco e Marrom em M, G e GG. Preto M tem só 3 peças.
const peca = (codigo: string, cor: string, tamanho: string, estoque: number) => ({ codigo, cor, tamanho, estoque, excluidaDaPublicacao: false });
const base = {
  data: {
    variacoes: ['M', 'G', 'GG'].flatMap((t) => [
      peca(`P-${t}`, 'Preto', t, t === 'M' ? 3 : 9), peca(`B-${t}`, 'Branco', t, 9), peca(`M-${t}`, 'Marrom', t, 9),
    ]),
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => base }));

const kitBase: KitVariacaoResumo = {
  id: 'K1', codigoPaiBase: '0001', codigoPaiKit: '0002', pecasPorKit: 2, soEmKit: false, reposicaoAuto: false,
  meta: 3, versao: 7, status: 'publicado', preco: 89.9,
};

function abrir(kit: Partial<KitVariacaoResumo> = {}, isAdmin = true, onOpenChange: (v: boolean) => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogGerenciarKit kit={{ ...kitBase, ...kit }} open onOpenChange={onOpenChange} isAdmin={isAdmin} />
    </QueryClientProvider>,
  );
}

describe('DialogGerenciarKit: andamento e foco', () => {
  beforeEach(() => {
    vi.mocked(gerenciarKitEdge).mockClear();
    detalhe.data.abertas = [];
    useFocoKitStore.getState().limpar();
  });

  it('montar mais com sucesso fecha e pede o foco na base', async () => {
    const fechar = vi.fn();
    const user = userEvent.setup();
    abrir({}, true, fechar);
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(fechar).toHaveBeenCalledWith(false));
    expect(useFocoKitStore.getState().alvo).toMatchObject({ codigoPaiBase: '0001', kitId: 'K1' });
  });

  it('montar que falha não fecha nem pede foco', async () => {
    vi.mocked(gerenciarKitEdge).mockResolvedValueOnce({ ok: false, mensagem: 'recusado' });
    const fechar = vi.fn();
    const user = userEvent.setup();
    abrir({}, true, fechar);
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Montar mais' }));
    await user.click(screen.getByRole('button', { name: 'Montar' }));
    await waitFor(() => expect(gerenciarKitEdge).toHaveBeenCalledTimes(1));
    expect(fechar).not.toHaveBeenCalled();
    expect(useFocoKitStore.getState().alvo).toBeNull();
  });

  it('desmontar com sucesso fecha e pede o foco na base', async () => {
    const fechar = vi.fn();
    const user = userEvent.setup();
    abrir({}, true, fechar);
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Desmontar' }));
    await user.click(screen.getByRole('button', { name: 'Desmontar kits' }));
    await waitFor(() => expect(fechar).toHaveBeenCalledWith(false));
    expect(useFocoKitStore.getState().alvo).toMatchObject({ codigoPaiBase: '0001' });
  });

  it('transferência ativa mostra a etapa em linguagem simples com o efeito', () => {
    detalhe.data.abertas = [{ id: 'T1', tipo: 'montar', estado: 'ativa', passo: 'conciliar', alerta: 'quarentena', criadoEm: '2026-11-08T10:00:00Z' }];
    const { baseElement } = abrir();
    expect(screen.getByText(/Conferindo vendas · passo 3 de 9/)).toBeInTheDocument();
    expect(baseElement.querySelector('[data-estado="ativa"].glow-effect-sombra')).not.toBeNull();
    expect(screen.queryByText(/^quarentena$/)).not.toBeInTheDocument();
  });
});
