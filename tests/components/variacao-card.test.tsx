import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VariacaoCard } from '@/components/variacao-card';
import type { Variacao } from '@/lib/tipos-dominio';

vi.mock('@/hooks/useImageUrl', () => ({
  useImageUrl: (path: string | undefined | null) => ({
    data: path ? `https://exemplo.test/${path}` : undefined,
  }),
  invalidarImagem: vi.fn(),
}));

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function variacao(over: Partial<Variacao> = {}): Variacao {
  return {
    codigo: '00445932',
    cor: 'Laranja',
    corHex: '#ff8800',
    corOrigem: 'vision',
    corEditadaPeloOperador: false,
    preco: 10,
    precoPublicacao: 10,
    precoPublicadoMl: null,
    estoque: 5,
    gtin: '7900000000001',
    fotoPath: undefined,
    excluidaDaPublicacao: false,
    mlVariationId: null,
    estoqueAnterior: null,
    custo: 5,
    pesoGramas: 100,
    alturaCm: 10,
    larguraCm: 10,
    comprimentoCm: 10,
    exibirComDesconto: false,
    descontoPct: null,
    atacado: null,
    ...over,
  };
}

const PROPS_BASE = {
  loteId: 'l1',
  onMudarPreco: vi.fn(),
  onMudarCor: vi.fn(),
  categoriaMlId: null,
  aliquotaPct: 8,
};

describe('VariacaoCard — zoom da foto', () => {
  it('sem fotoPath, não existe botão de ampliar foto', () => {
    renderWithClient(<VariacaoCard variacao={variacao({ fotoPath: undefined })} {...PROPS_BASE} />);
    expect(screen.queryByRole('button', { name: 'Ampliar foto da variação' })).not.toBeInTheDocument();
  });

  it('com fotoPath, clicar no botão abre dialog com a mesma imagem da miniatura', () => {
    renderWithClient(<VariacaoCard variacao={variacao({ fotoPath: 'user/00445932.jpeg' })} {...PROPS_BASE} />);
    const miniatura = screen.getByRole('img', { name: 'Laranja' });
    expect(miniatura).toHaveAttribute('src', 'https://exemplo.test/user/00445932.jpeg');

    fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto da variação' }));

    const dialog = screen.getByRole('dialog');
    const imgAmpliada = within(dialog).getByRole('img');
    expect(imgAmpliada).toHaveAttribute('src', 'https://exemplo.test/user/00445932.jpeg');
  });

  it('Esc fecha o dialog', () => {
    renderWithClient(<VariacaoCard variacao={variacao({ fotoPath: 'user/00445932.jpeg' })} {...PROPS_BASE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto da variação' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
