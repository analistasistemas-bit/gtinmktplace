import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

// 2026-10-18: a Revisão não tinha onde editar a FONTE da IA (descricao_pai). O operador
// editava a descrição do anúncio, "Regenerar" a sobrescrevia a partir da fonte vazia e os dados
// digitados sumiam (conjunto 00000043). O campo "Descrição detalhada" edita a fonte, e o
// Regenerar salva a fonte pendente ANTES de chamar a IA.

const updateTituloSpy = vi.fn().mockResolvedValue(undefined);
const updateDescricaoSpy = vi.fn().mockResolvedValue(undefined);
const updateFonteSpy = vi.fn().mockResolvedValue(undefined);
const ordem: string[] = [];
const regenerarSpy = vi.fn(() => { ordem.push('regenerar'); });

vi.mock('@/components/variacao-card', () => ({
  VariacaoCard: ({ variacao, onMudarPreco }: { variacao: Variacao; onMudarPreco: (codigo: string, v: number) => void }) => (
    <div>
      <input
        aria-label={`preco-${variacao.codigo}`}
        value={variacao.precoPublicacao ?? ''}
        onChange={(e) => onMudarPreco(variacao.codigo, Number(e.target.value))}
      />
      {variacao.editadoPeloOperador && <span>fixado-{variacao.codigo}</span>}
    </div>
  ),
}));
vi.mock('@/components/painel-analise', () => ({ PainelAnalise: () => null }));
vi.mock('@/components/card-categoria', () => ({ CardCategoria: () => null }));
vi.mock('@/components/foto-capa-familia', () => ({ FotoCapaFamilia: () => null }));
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useUpdateVariacaoPreco: () => ({ mutateAsync: vi.fn() }),
  useUpdateVariacaoCor: () => ({ mutateAsync: vi.fn() }),
  useUpdateVariacaoGtin: () => ({ mutateAsync: vi.fn() }),
  useUpdateFamiliaTitulo: () => ({ mutateAsync: updateTituloSpy }),
  useUpdateFamiliaDescricao: () => ({ mutateAsync: updateDescricaoSpy }),
  useUpdateFamiliaFonte: () => ({ mutateAsync: (a: unknown) => { ordem.push('fonte'); return updateFonteSpy(a); } }),
  useRegenerarCopy: () => ({ mutate: regenerarSpy, isPending: false }),
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

function variacao(over: Partial<Variacao> = {}): Variacao {
  return {
    codigo: 'V1', cor: '', tamanho: null, corHex: '#fff', corOrigem: null, corEditadaPeloOperador: false,
    preco: 59.9, precoPublicacao: null, precoPublicadoMl: null, estoque: 5, gtin: null,
    excluidaDaPublicacao: false, mlVariationId: null, estoqueAnterior: null, custo: null,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null,
    atacado: null,
    ...over,
  };
}

function familia(over: Partial<Familia> = {}): Familia {
  return {
    id: 'fam-1', loteId: 'lote-1', codigoPai: '099001', titulo: 'Nome cru do catálogo',
    descricao: 'Descrição verbatim do catálogo ML',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '', precoReancoradoLider: false,
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null, analiseMercado: null,
    tipoAviamento: null, categoriaMlId: null, formatoPublicacaoMl: null, categoriaNome: null,
    tipoOrigem: null, concorrenciaCategoriaId: null, origem: 'nacional', atributosFaltantes: null,
    catalogoCategoriaSugeridaId: null, catalogoCategoriaSugeridaNome: null, catalogoCategoriaSugeridaVendedores: null,
    atributosMl: [], precoMin: 10, precoMax: 10, precoAbaixo20pc: false, capaStoragePath: null,
    capa2StoragePath: null, capa3StoragePath: null, variacaoPrincipalCodigo: null,
    variacoes: [variacao()],
    status: 'processando', tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    mlPermalink: null, mlItemId: null, anuncios: [], mudancaEstrutural: null, erroMensagem: null,
    atacado: null, atacadoStatus: null, atacadoErro: null,
    ...over,
  };
}

function renderCom(qc: QueryClient, f: Familia) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <FamiliaExpanded familia={f} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}


describe('FamiliaExpanded — descrição detalhada (fonte da IA)', () => {
  beforeEach(() => { updateFonteSpy.mockClear(); regenerarSpy.mockClear(); ordem.length = 0; });

  it('mostra a fonte atual e salva no blur só quando o operador digitou', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(renderCom(qc, familia({ fonteDescricao: 'Composição: algodão' })));
    const campo = screen.getByLabelText('DESCRIÇÃO DETALHADA (FONTE DA IA)');
    expect(campo).toHaveValue('Composição: algodão');

    fireEvent.blur(campo);
    expect(updateFonteSpy).not.toHaveBeenCalled();

    fireEvent.change(campo, { target: { value: 'Composição: 92% poliéster' } });
    fireEvent.blur(campo);
    expect(updateFonteSpy).toHaveBeenCalledWith({ id: 'fam-1', fonte: 'Composição: 92% poliéster' });
  });

  it('Regenerar salva a fonte pendente antes de chamar a IA', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(renderCom(qc, familia({ fonteDescricao: '' })));
    fireEvent.change(screen.getByLabelText('DESCRIÇÃO DETALHADA (FONTE DA IA)'), { target: { value: 'Proteção UV: 30' } });
    fireEvent.click(screen.getByRole('button', { name: /Regenerar descrição/ }));
    await vi.waitFor(() => expect(regenerarSpy).toHaveBeenCalled());
    expect(ordem).toEqual(['fonte', 'regenerar']);
  });
});
