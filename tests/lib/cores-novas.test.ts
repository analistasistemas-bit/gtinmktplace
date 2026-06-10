import { describe, it, expect } from 'vitest';
import { coresNovasSemFoto, totalCoresNovasSemFoto } from '@/lib/cores-novas';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

function variacao(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000001',
    cor: 'Azul',
    corHex: '#0000ff',
    corOrigem: 'descricao',
    corEditadaPeloOperador: false,
    preco: 10,
    precoPublicacao: 10,
    estoque: 5,
    gtin: null,
    fotoPath: undefined,
    excluidaDaPublicacao: false,
    mlVariationId: null,
    estoqueAnterior: null,
    custo: null,
    pesoGramas: null,
    alturaCm: null,
    larguraCm: null,
    comprimentoCm: null,
    ...over,
  };
}

function familia(over: Partial<Familia>): Familia {
  return {
    id: 'f1',
    loteId: 'l1',
    codigoPai: '00000100',
    titulo: 'FITA EXEMPLO',
    descricao: '',
    operacao: 'UPDATE',
    estrategiaPreco: 'PROPRIO',
    estrategiaMotivo: '',
    concorrencia: 'sem',
    concorrenciaVendedores: 0,
    concorrenciaPrecoMin: null,
    analiseMercado: null,
    tipoAviamento: 'fita',
    categoriaMlId: 'MLB255054',
    precoMin: 0,
    precoMax: 0,
    precoAbaixo20pc: false,
    capaStoragePath: null,
    capa2StoragePath: null,
    variacaoPrincipalCodigo: null,
    variacoes: [],
    status: 'pronto',
    tokensInput: null,
    tokensOutput: null,
    custoCentavos: null,
    tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0,
    mlPermalink: null,
    mlItemId: 'MLB1',
    mudancaEstrutural: null,
    erroMensagem: null,
    exibirComDesconto: false,
    descontoPct: null,
    ...over,
  };
}

describe('coresNovasSemFoto', () => {
  it('lista a cor nova de UPDATE sem mlVariationId e sem foto', () => {
    const f = familia({
      variacoes: [
        variacao({ codigo: '00000101', mlVariationId: 'V1', fotoPath: 'a.jpg' }), // casada
        variacao({ codigo: '00000102', mlVariationId: null, fotoPath: undefined }), // nova sem foto
      ],
    });
    const r = coresNovasSemFoto([f]);
    expect(r).toEqual([
      { codigoPai: '00000100', titulo: 'FITA EXEMPLO', codigos: ['00000102'] },
    ]);
    expect(totalCoresNovasSemFoto([f])).toBe(1);
  });

  it('ignora cor nova que já tem foto', () => {
    const f = familia({
      variacoes: [variacao({ codigo: '00000102', mlVariationId: null, fotoPath: 'nova.jpg' })],
    });
    expect(coresNovasSemFoto([f])).toEqual([]);
    expect(totalCoresNovasSemFoto([f])).toBe(0);
  });

  it('ignora famílias CREATE (não são reposição de anúncio existente)', () => {
    const f = familia({
      operacao: 'CREATE',
      variacoes: [variacao({ codigo: '00000102', mlVariationId: null, fotoPath: undefined })],
    });
    expect(coresNovasSemFoto([f])).toEqual([]);
  });

  it('conta cor nova mesmo desmarcada (opt-in)', () => {
    const f = familia({
      variacoes: [variacao({ codigo: '00000102', mlVariationId: null, fotoPath: undefined, excluidaDaPublicacao: true })],
    });
    expect(totalCoresNovasSemFoto([f])).toBe(1);
  });

  it('retorna vazio quando não há cores novas sem foto', () => {
    const f = familia({
      variacoes: [variacao({ codigo: '00000101', mlVariationId: 'V1', fotoPath: 'a.jpg' })],
    });
    expect(coresNovasSemFoto([f])).toEqual([]);
    expect(totalCoresNovasSemFoto([f])).toBe(0);
  });

  it('agrupa por família, somando entre várias famílias', () => {
    const f1 = familia({
      codigoPai: '00000100', titulo: 'FITA A',
      variacoes: [
        variacao({ codigo: '00000102', mlVariationId: null }),
        variacao({ codigo: '00000103', mlVariationId: null }),
      ],
    });
    const f2 = familia({
      id: 'f2', codigoPai: '00000200', titulo: 'FITA B',
      variacoes: [variacao({ codigo: '00000201', mlVariationId: null })],
    });
    expect(coresNovasSemFoto([f1, f2])).toEqual([
      { codigoPai: '00000100', titulo: 'FITA A', codigos: ['00000102', '00000103'] },
      { codigoPai: '00000200', titulo: 'FITA B', codigos: ['00000201'] },
    ]);
    expect(totalCoresNovasSemFoto([f1, f2])).toBe(3);
  });
});
