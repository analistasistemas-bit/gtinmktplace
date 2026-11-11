import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

// O ML recusa título acima de 60 caracteres: o operador precisa ver o aviso enquanto edita.

vi.mock('@/components/variacao-card', () => ({ VariacaoCard: () => null }));
vi.mock('@/components/painel-analise', () => ({ PainelAnalise: () => null }));
vi.mock('@/components/card-categoria', () => ({ CardCategoria: () => null }));
vi.mock('@/components/foto-capa-familia', () => ({ FotoCapaFamilia: () => null }));
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useUpdateVariacaoPreco: () => ({ mutateAsync: vi.fn() }),
  useUpdateVariacaoCor: () => ({ mutateAsync: vi.fn() }),
  useUpdateVariacaoGtin: () => ({ mutateAsync: vi.fn() }),
  useUpdateFamiliaTitulo: () => ({ mutateAsync: vi.fn() }),
  useUpdateFamiliaDescricao: () => ({ mutateAsync: vi.fn() }),
  useRegenerarCopy: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateVariacaoPrincipal: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useImageUrl', () => ({
  useImageUrl: () => ({ data: undefined }),
  invalidarImagem: vi.fn(),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => ({ data: undefined }) }));
vi.mock('@/lib/upload-imagens', () => ({
  subirCapaFamilia: vi.fn(), removerCapaFamilia: vi.fn(),
  subirCapa2Familia: vi.fn(), removerCapa2Familia: vi.fn(),
  subirCapa3Familia: vi.fn(), removerCapa3Familia: vi.fn(),
}));
vi.mock('@/lib/publicar', () => ({ setVariacaoExcluida: vi.fn() }));

import { FamiliaExpanded } from '../familia-expanded';

const variacao: Variacao = {
  codigo: 'V1', cor: 'Azul', tamanho: null, corHex: '#00f', corOrigem: null, corEditadaPeloOperador: false,
  preco: 10, precoPublicacao: 10, precoPublicadoMl: null, estoque: 5, gtin: null,
  excluidaDaPublicacao: false, mlVariationId: null, estoqueAnterior: null, custo: null,
  pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null,
  atacado: null,
};

const familia: Familia = {
  id: 'fam-1', loteId: 'lote-1', codigoPai: '099001', titulo: 'Produto', descricao: 'Desc',
  operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '', precoReancoradoLider: false,
  concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null, analiseMercado: null,
  tipoAviamento: null, categoriaMlId: null, formatoPublicacaoMl: null, categoriaNome: null,
  tipoOrigem: null, concorrenciaCategoriaId: null, origem: 'nacional', atributosFaltantes: null,
  catalogoCategoriaSugeridaId: null, catalogoCategoriaSugeridaNome: null, catalogoCategoriaSugeridaVendedores: null,
  atributosMl: [], precoMin: 10, precoMax: 10, precoAbaixo20pc: false, capaStoragePath: null,
  capa2StoragePath: null, capa3StoragePath: null, variacaoPrincipalCodigo: null, variacoes: [variacao],
  status: 'pendente', tokensInput: null, tokensOutput: null, custoCentavos: null,
  tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
  mlPermalink: null, mlItemId: null, anuncios: [], mudancaEstrutural: null, erroMensagem: null,
  atacado: null, atacadoStatus: null, atacadoErro: null,
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <FamiliaExpanded familia={familia} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return screen.getByLabelText('TÍTULO');
}

describe('FamiliaExpanded — limite de 60 caracteres do título (ML)', () => {
  it('60 caracteres: mostra o contador sem aviso', () => {
    fireEvent.change(montar(), { target: { value: 'a'.repeat(60) } });
    expect(screen.getByText('60/60')).toBeInTheDocument();
    expect(screen.queryByText(/Mercado Livre aceita no máximo 60/)).toBeNull();
  });

  it('61 caracteres: avisa que passou do limite do ML', () => {
    const input = montar();
    fireEvent.change(input, { target: { value: 'a'.repeat(61) } });
    expect(screen.getByText('61/60')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Mercado Livre aceita no máximo 60/);
    expect(input).toHaveAccessibleDescription(/Mercado Livre aceita no máximo 60/);
  });
});
