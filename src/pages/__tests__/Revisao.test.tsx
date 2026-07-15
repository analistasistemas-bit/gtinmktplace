import { describe, expect, it } from 'vitest';
import { filtrarFamilias } from '../Revisao';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

function criarVariacao(overrides: Partial<Variacao> = {}): Variacao {
  return {
    codigo: 'COD1',
    cor: 'Azul',
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
    exibirComDesconto: false,
    descontoPct: null,
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
