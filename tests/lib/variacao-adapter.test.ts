import { describe, it, expect } from 'vitest';
import { variacaoFromRow } from '../../src/lib/queries';
import type { Database } from '../../src/lib/database.types';

type VariacaoRow = Database['public']['Tables']['variacoes']['Row'];

function baseRow(over: Partial<VariacaoRow>): VariacaoRow {
  return {
    id: 'v1', familia_id: 'f1', user_id: 'u1', codigo: '00000101',
    cor: 'Azul', cor_hex: '#00f', cor_origem: 'descricao',
    cor_editada_pelo_operador: false, preco: 10, preco_publicacao: 9,
    preco_editado_pelo_operador: false, estoque: 5, gtin: null,
    imagem_path: 'u1/l1/00000101.jpeg', altura_cm: 1, largura_cm: 1,
    comprimento_cm: 1, peso_gramas: 1, ml_picture_id: null,
    ml_variation_id: null, excluida_da_publicacao: false,
    nome: null, atualizado_em: '', criado_em: '',
    ...over,
  };
}

describe('variacaoFromRow', () => {
  it('mapeia excluida_da_publicacao', () => {
    expect(variacaoFromRow(baseRow({ excluida_da_publicacao: true })).excluidaDaPublicacao).toBe(true);
    expect(variacaoFromRow(baseRow({ excluida_da_publicacao: false })).excluidaDaPublicacao).toBe(false);
  });

  it('mapeia custo do banco (string numérica → number)', () => {
    const base: any = {
      id: 'v1', codigo: '001', cor: 'Azul', cor_hex: null, cor_origem: 'descricao',
      cor_editada_pelo_operador: false, preco: '2.95', preco_publicacao: '12.00',
      estoque: 10, gtin: null, imagem_path: null, preco_editado_pelo_operador: false,
      excluida_da_publicacao: false, ml_variation_id: null, estoque_anterior: null,
      custo: '1.88',
    };
    expect(variacaoFromRow(base).custo).toBeCloseTo(1.88, 2);
  });
});
