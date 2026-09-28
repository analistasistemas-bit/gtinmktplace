import { describe, expect, it } from 'vitest';
import { filtrarFamilias, avisosParticipacaoPromocao } from '../Revisao';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

function criarVariacao(overrides: Partial<Variacao> = {}): Variacao {
  return {
    codigo: 'COD1',
    cor: 'Azul',
    tamanho: null,
    corHex: '#0000ff',
    corOrigem: null,
    corEditadaPeloOperador: false,
    preco: 100,
    precoPublicacao: 100,
    precoPublicadoMl: 100,
    estoque: 10,
    gtin: null,
    excluidaDaPublicacao: false,
    mlVariationId: null,
    estoqueAnterior: null,
    custo: null,
    pesoGramas: null,
    alturaCm: null,
    larguraCm: null,
    comprimentoCm: null,
    atacado: null,
    ...overrides,
  };
}

function criarFamilia(overrides: Partial<Familia> = {}): Familia {
  return {
    id: 'fam-1',
    loteId: 'lote-1',
    codigoPai: 'PAI1',
    titulo: 'Produto teste',
    descricao: '',
    operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO',
    estrategiaMotivo: '',
    precoReancoradoLider: false,
    concorrencia: 'sem',
    concorrenciaVendedores: 0,
    concorrenciaPrecoMin: null,
    analiseMercado: null,
    tipoAviamento: null,
    categoriaMlId: null,
    categoriaNome: null,
    tipoOrigem: null,
    concorrenciaCategoriaId: null,
    catalogoCategoriaSugeridaId: null,
    catalogoCategoriaSugeridaNome: null,
    catalogoCategoriaSugeridaVendedores: null,
    origem: 'nacional',
    atributosFaltantes: null,
    atributosMl: [],
    precoMin: 100,
    precoMax: 100,
    precoAbaixo20pc: false,
    capaStoragePath: null,
    capa2StoragePath: null,
    capa3StoragePath: null,
    variacaoPrincipalCodigo: null,
    variacoes: [criarVariacao()],
    status: 'pronto',
    tokensInput: null,
    tokensOutput: null,
    custoCentavos: null,
    tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0,
    mlPermalink: null,
    mlItemId: null,
    anuncios: [],
    mudancaEstrutural: null,
    erroMensagem: null,
    atacado: null,
    atacadoStatus: null,
    atacadoErro: null,
    ...overrides,
  } as Familia;
}

describe('filtrarFamilias - preco_alterado', () => {
  it('mantém só famílias UPDATE com preço divergindo do publicado no ML', () => {
    const updateComAlteracao = criarFamilia({
      id: 'update-alterada',
      operacao: 'UPDATE',
      variacoes: [criarVariacao({ precoPublicacao: 150, precoPublicadoMl: 100 })],
    });
    const updateSemAlteracao = criarFamilia({
      id: 'update-igual',
      operacao: 'UPDATE',
      variacoes: [criarVariacao({ precoPublicacao: 100, precoPublicadoMl: 100 })],
    });
    const createComPrecoDiferente = criarFamilia({
      id: 'create-1',
      operacao: 'CREATE',
      variacoes: [criarVariacao({ precoPublicacao: 150, precoPublicadoMl: 100 })],
    });

    const resultado = filtrarFamilias(
      [updateComAlteracao, updateSemAlteracao, createComPrecoDiferente],
      'preco_alterado',
      '',
    );

    expect(resultado.map((f) => f.id)).toEqual(['update-alterada']);
  });
});

describe('avisosParticipacaoPromocao (Task 9, ADR-0174 decisão 9)', () => {
  it('avisa só a família UPDATE com preço alterado cujo mlItemId está participando', () => {
    const alteradaEParticipando = criarFamilia({
      id: 'fam-1',
      titulo: 'Tênis Azul',
      operacao: 'UPDATE',
      mlItemId: 'MLB1',
      variacoes: [criarVariacao({ precoPublicacao: 150, precoPublicadoMl: 100 })],
    });
    const alteradaMasNaoParticipando = criarFamilia({
      id: 'fam-2',
      operacao: 'UPDATE',
      mlItemId: 'MLB2',
      variacoes: [criarVariacao({ precoPublicacao: 150, precoPublicadoMl: 100 })],
    });
    const participandoMasSemAlteracao = criarFamilia({
      id: 'fam-3',
      operacao: 'UPDATE',
      mlItemId: 'MLB3',
      variacoes: [criarVariacao({ precoPublicacao: 100, precoPublicadoMl: 100 })],
    });

    const participacoes = new Map([['MLB1', 'Ofertas Relâmpago'], ['MLB3', 'Ofertas Relâmpago']]);
    const avisos = avisosParticipacaoPromocao(
      [alteradaEParticipando, alteradaMasNaoParticipando, participandoMasSemAlteracao],
      new Map(),
      participacoes,
    );

    expect(avisos).toEqual([
      { id: 'fam-1', texto: '⚠️ Tênis Azul participa da Ofertas Relâmpago: mudar o preço pode tirar o anúncio da promoção.' },
    ]);
  });

  it('User Products: acha a participação pelos itens de anuncios_externos_itens (codigoPai), não só pelo mlItemId da família', () => {
    const familiaUp = criarFamilia({
      id: 'fam-up',
      titulo: 'Camiseta P/M/G',
      codigoPai: 'PAI-UP',
      operacao: 'UPDATE',
      mlItemId: 'MLB100', // primeiro item da partição 0 — não é o que está na promo
      formatoPublicacaoMl: 'user_products',
      variacoes: [criarVariacao({ precoPublicacao: 150, precoPublicadoMl: 100 })],
    });

    const itensUp = new Map([['PAI-UP', ['MLB100', 'MLB101']]]);
    const participacoes = new Map([['MLB101', 'Semana do Consumidor']]);

    const avisos = avisosParticipacaoPromocao([familiaUp], itensUp, participacoes);

    expect(avisos).toEqual([
      { id: 'fam-up', texto: '⚠️ Camiseta P/M/G participa da Semana do Consumidor: mudar o preço pode tirar o anúncio da promoção.' },
    ]);
  });

  it('sem participação nenhuma, não avisa', () => {
    const familia = criarFamilia({
      operacao: 'UPDATE',
      mlItemId: 'MLB9',
      variacoes: [criarVariacao({ precoPublicacao: 150, precoPublicadoMl: 100 })],
    });
    expect(avisosParticipacaoPromocao([familia], new Map(), new Map())).toEqual([]);
  });
});
