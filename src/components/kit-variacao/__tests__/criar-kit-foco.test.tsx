// ADR-0200 (adendo 08/11): criar o kit fecha o diálogo e pede a Publicados o foco na linha da base.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCriarKitVariacao } from '../dialog-criar-kit-variacao';

const v = (codigo: string, cor: string, tamanho: string, estoque: number) => ({
  codigo, cor, tamanho, estoque, preco: 49.9, precoPublicacao: 49.9, excluidaDaPublicacao: false,
  custo: 20, pesoGramas: 200, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});
const familia = {
  data: {
    id: 'FAM', codigoPai: '0001', titulo: 'Blusa Canelada', origem: 'nacional', categoriaMlId: 'MLB3112',
    variacoes: [
      v('P-M', 'Preto', 'M', 2), v('B-M', 'Branco', 'M', 5), v('M-M', 'Marrom', 'M', 5),
      v('P-G', 'Preto', 'G', 5), v('B-G', 'Branco', 'G', 5), v('M-G', 'Marrom', 'G', 5),
    ],
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => familia }));
const modulos = { data: ['kit_variacao'] as string[] };
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulos }));
vi.mock('@/components/kit-variacao/simulador-kit', () => ({
  SimuladorKit: ({ onPodeSeguir }: { onPodeSeguir?: (p: boolean) => void }) => {
    onPodeSeguir?.(true);
    return <div>simulador</div>;
  },
}));
vi.mock('@/lib/kit-variacao-edge', () => ({
  criarKitVariacaoEdge: vi.fn(async () => ({ ok: true, kit_id: 'K1' })),
  enviarFotoKit: vi.fn(async (pasta: string, rotulo: string) => `ORG/${pasta}/${rotulo}.jpg`),
  gerarTextoKitEdge: vi.fn(async () => ({ ok: true, titulo: 'Kit 2 Blusas Canelada', descricao: 'Kit com 2 peças.', previa_id: 'PV1' })),
  gerarFotoKitEdge: vi.fn(async (p: { requestId: string }) => ({ ok: true, path: `ORG/kit-variacao-ia/${p.requestId}.png`, url: `https://x/${p.requestId}.png` })),
}));
import { criarKitVariacaoEdge } from '@/lib/kit-variacao-edge';
import { useFocoKitStore } from '@/stores/foco-kit-store';

function abrir(isAdmin = true, onOpenChange: (v: boolean) => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DialogCriarKitVariacao familiaBaseId="FAM" open onOpenChange={onOpenChange} isAdmin={isAdmin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function montar(user: ReturnType<typeof userEvent.setup>, cores: string[], qtd: Record<string, string>) {
  for (const c of cores) await user.click(screen.getByRole('checkbox', { name: `Cor ${c}` }));
  for (const [rotulo, n] of Object.entries(qtd)) {
    await user.clear(screen.getByLabelText(`Quantidade ${rotulo}`));
    await user.type(screen.getByLabelText(`Quantidade ${rotulo}`), n);
  }
}

describe('DialogCriarKitVariacao: foco depois de criar', () => {
  it('sucesso fecha o diálogo e pede o foco na base com o kit criado', async () => {
    modulos.data = ['kit_variacao', 'imagem_ia'];
    useFocoKitStore.getState().limpar();
    const fechar = vi.fn();
    const user = userEvent.setup();
    abrir(true, fechar);
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await screen.findByDisplayValue('Kit 2 Blusas Canelada');
    await user.click(screen.getByRole('button', { name: 'Gerar foto Preto e Branco' }));
    fireEvent.load(await screen.findByRole('img', { name: 'Foto gerada Preto e Branco' }));
    await user.click(screen.getByRole('button', { name: 'Usar foto gerada Preto e Branco' }));
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: 'Criar kit' }));
    await vi.waitFor(() => expect(criarKitVariacaoEdge).toHaveBeenCalled());
    await vi.waitFor(() => expect(fechar).toHaveBeenCalledWith(false));
    expect(useFocoKitStore.getState().alvo).toMatchObject({ codigoPaiBase: '0001', kitId: 'K1' });
  });
});
