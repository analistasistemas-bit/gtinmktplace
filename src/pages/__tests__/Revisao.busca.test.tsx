import { describe, expect, it } from 'vitest';
import { filtrarFamilias } from '../Revisao';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

function mockFamilia(over: Partial<Familia> = {}): Familia {
  return {
    id: 'fam-1',
    loteId: 'lote-1',
    codigoPai: 'PAI01',
    titulo: 'Toalha de Banho Algodão',
    tipoAviamento: 'outro',
    operacao: 'CREATE',
    status: 'pronto',
    precoAbaixo20pc: false,
    categoriaMlId: 'MLB123',
    categoriaNome: 'Toalhas',
    variacoes: [
      {
        id: 'v1',
        familiaId: 'fam-1',
        codigo: 'VAR01',
        cor: 'Azul Bebê',
        gtin: '7890001',
        estoque: 10,
        custo: 10,
        preco: 20,
        excluida: false,
        status: 'pronto',
      } as unknown as Variacao,
    ],
    ...over,
  } as Familia;
}

describe('filtrarFamilias — busca com acentos', () => {
  it('acha produto com acento pesquisando sem acento', () => {
    const lista = [mockFamilia({ titulo: 'Toalha de Banho Algodão' })];
    const r = filtrarFamilias(lista, 'todos', 'algodao');
    expect(r).toHaveLength(1);
  });

  it('acha produto sem acento pesquisando com acento', () => {
    const lista = [mockFamilia({ titulo: 'Toalha de Banho Algodao' })];
    const r = filtrarFamilias(lista, 'todos', 'algodão');
    expect(r).toHaveLength(1);
  });

  it('acha variação por cor com acento pesquisando sem acento', () => {
    const lista = [mockFamilia()];
    const r = filtrarFamilias(lista, 'todos', 'bebe');
    expect(r).toHaveLength(1);
  });

  it('acha variação por código', () => {
    const lista = [mockFamilia()];
    const r = filtrarFamilias(lista, 'todos', 'VAR01');
    expect(r).toHaveLength(1);
  });
});
