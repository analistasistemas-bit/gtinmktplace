import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VariacaoCard } from '@/components/variacao-card';
import { fmtBRL } from '@/lib/formato';
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

// Rotulagem só (dono do produto): "preço não gravado" não era bug de dado — o input da
// Revisão sempre editou/exibiu `precoPublicacao ?? preco` (motor de precificação,
// ADR-0020/0055/0065); o operador só não tinha como saber que o número ali era uma SUGESTÃO
// da IA, não o valor que ele digitou (rotulado "mín. líquido" logo abaixo, sem dizer a
// origem). Este teste cobre só a marca nova — não toca precoExterno/onMudarPreco/SemaforoPreco.
//
// Consistência (achado do dono do produto revendo o browser): a marca usa `StatusPill
// tone="info"` + ícone `Sparkles`, o MESMO padrão do chip "Sugerida por IA — confira" do card
// de Categoria (card-categoria.tsx:150-153, poucos cm acima na mesma tela) — antes era um
// <span> cinza que o operador não lia como a mesma classe de informação.
describe('VariacaoCard — marca de preço sugerido pela IA', () => {
  it('preço de publicação diferente do mínimo: mostra o pill "sugerido pela IA" (tone=info) com o texto explicativo', () => {
    renderWithClient(<VariacaoCard variacao={variacao({ preco: 100, precoPublicacao: 135.9 })} {...PROPS_BASE} />);
    const marca = screen.getByText('sugerido pela IA');
    // data-tone="info": prova que é o StatusPill do padrão card-categoria.tsx, não um <span> solto.
    expect(marca).toHaveAttribute('data-tone', 'info');
    expect(marca).toHaveAttribute(
      'title',
      `Você informou ${fmtBRL(100)} como preço mínimo; a IA sugeriu ${fmtBRL(135.9)} com base na concorrência. Edite o campo para usar outro valor.`,
    );
    // Sparkles renderiza como <svg> — mesmo ícone do chip de Categoria.
    expect(marca.querySelector('svg')).toBeInTheDocument();
  });

  it('preço de publicação igual ao mínimo: não mostra o pill (caso comum, sem poluir)', () => {
    renderWithClient(<VariacaoCard variacao={variacao({ preco: 100, precoPublicacao: 100 })} {...PROPS_BASE} />);
    expect(screen.queryByText('sugerido pela IA')).not.toBeInTheDocument();
  });

  it('sem preço de publicação (null): não mostra o pill', () => {
    renderWithClient(<VariacaoCard variacao={variacao({ preco: 100, precoPublicacao: null })} {...PROPS_BASE} />);
    expect(screen.queryByText('sugerido pela IA')).not.toBeInTheDocument();
  });
});
