import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FamiliaExpanded } from '@/components/familia-expanded';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

// ADR-0151 D-2: gatilho "Criar kits" na Revisão — mesmo diálogo da Task 7 (Publicados),
// desabilitado + tooltip por motivo (ADR-0060), nunca escondido. Cobre também a verificação
// (D-4) de que o caminho de recuperação (kit falho vira card comum na Revisão) não é bloqueado
// por nenhum guard novo desta task. O badge de sequenciamento fica no card sempre visível —
// testado em tests/components/revisao-kit-badge.test.tsx (BadgeKitsAguardando em Revisao.tsx).

const useProfileMock = vi.fn();
const useModulosHabilitadosMock = vi.fn();
const useKitsDoProdutoMock = vi.fn();

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => useProfileMock(),
}));
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => useModulosHabilitadosMock(),
}));
vi.mock('@/hooks/useKitsDoProduto', () => ({
  useKitsDoProduto: (codigoPai: string, enabled: boolean) => useKitsDoProdutoMock(codigoPai, enabled),
}));

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function cor(over: Partial<Variacao> = {}): Variacao {
  return {
    codigo: '02719606', cor: 'Cereja 2018', corHex: '#a00', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 19.9, precoPublicacao: 19.9, estoque: 30,
    gtin: '7909857002676', fotoPath: 'user/foto.jpeg', excluidaDaPublicacao: false,
    mlVariationId: null, estoqueAnterior: null, custo: 5.5, pesoGramas: 120,
    ...over,
  };
}

function fam(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00445932', titulo: 'FITAS PROGRESSO N.1', descricao: 'd',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    analiseMercado: null, tipoAviamento: 'fita', categoriaMlId: 'MLB255054',
    precoMin: 19.9, precoMax: 19.9, precoAbaixo20pc: false, capaStoragePath: null,
    variacoes: [cor()], status: 'pronto', tokensInput: null, tokensOutput: null,
    custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    mlPermalink: null, mlItemId: null, erroMensagem: null, mudancaEstrutural: null,
    concorrenciaCategoriaId: null, kitBaseCodigoPai: null,
    ...over,
  } as Familia;
}

beforeEach(() => {
  useProfileMock.mockReturnValue({ isAdmin: true });
  useModulosHabilitadosMock.mockReturnValue({ data: ['estoque'] });
  useKitsDoProdutoMock.mockReturnValue({ data: [] });
});

describe('FamiliaExpanded — botão "Criar kits" (ADR-0151 D-2)', () => {
  it('habilitado: admin, módulo Estoque, família pronta, sem variação de cor e ainda não é kit', () => {
    renderWithClient(<FamiliaExpanded familia={fam()} />);
    expect(screen.getByRole('button', { name: 'Criar kits' })).toBeEnabled();
  });

  it('desabilitado sem o módulo Estoque', () => {
    useModulosHabilitadosMock.mockReturnValue({ data: [] });
    renderWithClient(<FamiliaExpanded familia={fam()} />);
    const btn = screen.getByRole('button', { name: 'Criar kits' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Kit vinculado exige o módulo Estoque habilitado.');
  });

  it('desabilitado para não-admin', () => {
    useProfileMock.mockReturnValue({ isAdmin: false });
    renderWithClient(<FamiliaExpanded familia={fam()} />);
    const btn = screen.getByRole('button', { name: 'Criar kits' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Somente administradores podem criar kits.');
  });

  it('desabilitado com mais de uma variação (cor)', () => {
    renderWithClient(<FamiliaExpanded familia={fam({ variacoes: [cor({ codigo: 'A' }), cor({ codigo: 'B', cor: 'Azul' })] })} />);
    const btn = screen.getByRole('button', { name: 'Criar kits' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Kit vinculado só existe para produto sem variação de cor.');
  });

  it('desabilitado quando o próprio anúncio já é um kit vinculado (card de recuperação, D-4)', () => {
    renderWithClient(<FamiliaExpanded familia={fam({ kitBaseCodigoPai: '00445932', status: 'erro' })} />);
    const btn = screen.getByRole('button', { name: 'Criar kits' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Este anúncio já é um kit vinculado.');
  });

  it('desabilitado quando a família ainda não está pronta na Revisão', () => {
    renderWithClient(<FamiliaExpanded familia={fam({ status: 'processando' })} />);
    const btn = screen.getByRole('button', { name: 'Criar kits' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'A família precisa estar pronta na Revisão antes de criar kits.');
  });

  it('clicar abre o diálogo de criação com os tamanhos já existentes marcados', async () => {
    useKitsDoProdutoMock.mockReturnValue({
      data: [{ familiaId: 'k1', codigoPai: '00445932', multiplicador: 2, status: 'pronto', mlPermalink: null, mlItemId: null }],
    });
    renderWithClient(<FamiliaExpanded familia={fam()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Criar kits' }));
    await screen.findByText('Criar kit vinculado');
    expect(screen.getByText('já criado')).toBeInTheDocument();
  });
});
