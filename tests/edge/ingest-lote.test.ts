import { describe, it, expect } from 'vitest';
import {
  validarColunas,
  agruparPorPai,
  normalizarCodigo,
  matchImagem,
} from '../../supabase/functions/_shared/parser';
import type { PlanilhaRow } from '../../supabase/functions/_shared/types';

const baseRow = (over: Partial<PlanilhaRow>): PlanilhaRow => ({
  CODIGO: '00000000', PAI: '0', NOME: '', UNIDADE: 'PC',
  GTIN: null, PRECO: 0, ESTOQUE: 0, DESCRICAO_DETALHADO: '',
  PESO_GRAMAS: 0, ALTURA_CM: 0, LARGURA_CM: 0, COMPRIMENTO_CM: 0,
  ...over,
});

describe('validarColunas', () => {
  it('aceita quando todas as colunas obrigatórias estão presentes', () => {
    const cols = ['CODIGO','PAI','NOME','UNIDADE','GTIN','PRECO','ESTOQUE','DESCRICAO_DETALHADO','PESO_GRAMAS','ALTURA_CM','LARGURA_CM','COMPRIMENTO_CM'];
    expect(() => validarColunas(cols)).not.toThrow();
  });
  it('lança quando falta coluna', () => {
    const cols = ['CODIGO','PAI','NOME'];
    expect(() => validarColunas(cols)).toThrow(/UNIDADE|GTIN|PRECO/);
  });
});

describe('normalizarCodigo', () => {
  it('zero-pad para 8 dígitos', () => {
    expect(normalizarCodigo(123)).toBe('00000123');
    expect(normalizarCodigo('123')).toBe('00000123');
    expect(normalizarCodigo('00000123')).toBe('00000123');
  });
});

describe('agruparPorPai', () => {
  it('PAI=0 vira chave; filhos têm PAI = codigo do pai', () => {
    const rows: PlanilhaRow[] = [
      baseRow({ CODIGO: '100', PAI: '0', NOME: 'Linha Azul - Família', DESCRICAO_DETALHADO: 'Pai' }),
      baseRow({ CODIGO: '101', PAI: '100', NOME: 'Linha Azul Royal', PRECO: 5 }),
      baseRow({ CODIGO: '102', PAI: '100', NOME: 'Linha Azul Marinho', PRECO: 5 }),
    ];
    const grupos = agruparPorPai(rows);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].codigo_pai).toBe('00000100');
    expect(grupos[0].variacoes).toHaveLength(2);
  });

  it('linha órfã (PAI aponta pra código que não existe) é ignorada e reportada', () => {
    const rows = [baseRow({ CODIGO: '999', PAI: '888', NOME: 'Órfã' })];
    expect(() => agruparPorPai(rows)).toThrow(/órfã|orfã|999/i);
  });

  it('PAI sem filhos vira família com 0 variações (anúncio só-pai não é vendável; vai pra erro)', () => {
    const rows = [baseRow({ CODIGO: '500', PAI: '0', NOME: 'Pai Solitário' })];
    expect(() => agruparPorPai(rows)).toThrow(/sem variações|solitário/i);
  });
});

describe('matchImagem', () => {
  it('encontra imagem por nome 00CODIGO.jpeg', () => {
    const paths = ['u1/l1/00000100.jpeg', 'u1/l1/00000101.jpeg', 'u1/l1/00000102.jpeg'];
    expect(matchImagem('100', paths)).toBe('u1/l1/00000100.jpeg');
    expect(matchImagem('101', paths)).toBe('u1/l1/00000101.jpeg');
  });
  it('aceita PNG, JPG, JPEG', () => {
    const paths = ['u1/l1/00000200.png'];
    expect(matchImagem('200', paths)).toBe('u1/l1/00000200.png');
  });
  it('retorna undefined se não houver match', () => {
    expect(matchImagem('999', ['u1/l1/00000100.jpeg'])).toBeUndefined();
  });
});
