import { describe, it, expect } from 'vitest';
import { prioridadeExcecao, ordenarPorExcecao } from '@/lib/revisao-ordem';
import type { Familia } from '@/lib/tipos-dominio';

const varOk = {
  codigo: 'c1', cor: 'Vermelho', corHex: '#f00', preco: 10, precoPublicacao: 10,
  estoque: 5, fotoPath: 'foto.jpg', excluidaDaPublicacao: false, mlVariationId: null,
};

function mk(over: Partial<Familia> & { id: string }): Familia {
  return {
    loteId: 'l', codigoPai: '1', titulo: 'T', descricao: '', operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO', estrategiaMotivo: '', concorrencia: 'sem',
    precoMin: 10, precoMax: 10, precoAbaixo20pc: false, tipoAviamento: 'linha',
    categoriaMlId: 'MLB123', variacoes: [{ ...varOk }], status: 'pronto', variacoesSemCor: 0,
    concorrenciaCategoriaId: null,
    ...over,
  } as Familia;
}

describe('prioridadeExcecao', () => {
  it('erro é a mais urgente (0)', () => {
    expect(prioridadeExcecao(mk({ id: 'e', status: 'erro' }))).toBe(0);
  });
  it('incompleta (sem foto) = 1', () => {
    expect(prioridadeExcecao(mk({ id: 'i', variacoes: [{ ...varOk, fotoPath: undefined }] }))).toBe(1);
  });
  it('aviso de preço = 2', () => {
    expect(prioridadeExcecao(mk({ id: 'a', precoAbaixo20pc: true }))).toBe(2);
  });
  it('pronto sem pendência = 3', () => {
    expect(prioridadeExcecao(mk({ id: 'ok' }))).toBe(3);
  });
  it('publicado fica por último (4)', () => {
    expect(prioridadeExcecao(mk({ id: 'p', status: 'publicado' }))).toBe(4);
  });
});

describe('ordenarPorExcecao', () => {
  it('ordena exceções primeiro, publicado por último', () => {
    const lista = [
      mk({ id: 'pub', status: 'publicado' }),
      mk({ id: 'ok' }),
      mk({ id: 'err', status: 'erro' }),
      mk({ id: 'avi', precoAbaixo20pc: true }),
      mk({ id: 'inc', variacoes: [{ ...varOk, fotoPath: undefined }] }),
    ];
    expect(ordenarPorExcecao(lista).map((f) => f.id)).toEqual(['err', 'inc', 'avi', 'ok', 'pub']);
  });

  it('é estável: mantém a ordem original dentro do mesmo nível', () => {
    const lista = [
      mk({ id: 'okA' }),
      mk({ id: 'errA', status: 'erro' }),
      mk({ id: 'okB' }),
      mk({ id: 'errB', status: 'erro' }),
    ];
    expect(ordenarPorExcecao(lista).map((f) => f.id)).toEqual(['errA', 'errB', 'okA', 'okB']);
  });

  it('não muta o array original', () => {
    const lista = [mk({ id: 'pub', status: 'publicado' }), mk({ id: 'err', status: 'erro' })];
    const copia = [...lista];
    ordenarPorExcecao(lista);
    expect(lista.map((f) => f.id)).toEqual(copia.map((f) => f.id));
  });
});
