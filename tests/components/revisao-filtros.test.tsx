import { describe, it, expect } from 'vitest';
import { filtrarFamilias } from '@/pages/Revisao';
import type { Familia } from '@/lib/tipos-dominio';

const FAMILIAS: Familia[] = [
  {
    id: 'a',
    loteId: 'lote-42',
    codigoPai: '1001',
    titulo: 'Linha Vermelha',
    descricao: '',
    operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO',
    estrategiaMotivo: '',
    concorrencia: 'sem',
    precoMin: 1,
    precoMax: 1,
    precoAbaixo20pc: false,
    variacoes: [
      { codigo: '222992', cor: 'vermelho', corHex: '#dc2626', preco: 1, estoque: 10 },
      { codigo: '997765', cor: 'rosa', corHex: '#f472b6', preco: 1, estoque: 10 },
    ],
    status: 'pronto',
  },
  {
    id: 'b',
    loteId: 'lote-42',
    codigoPai: '1002',
    titulo: 'Botão Azul',
    descricao: '',
    operacao: 'UPDATE',
    estrategiaPreco: 'COMPETITIVO',
    estrategiaMotivo: '',
    concorrencia: 'alta',
    precoMin: 1,
    precoMax: 1,
    precoAbaixo20pc: true,
    variacoes: [
      { codigo: '300001', cor: 'azul', corHex: '#2563eb', preco: 1, estoque: 5 },
    ],
    status: 'pronto',
  },
];

describe('filtrarFamilias', () => {
  it('retorna todas quando filtro=todos e busca vazia', () => {
    expect(filtrarFamilias(FAMILIAS, 'todos', '').length).toBe(2);
  });

  it('filtra só CREATE', () => {
    const out = filtrarFamilias(FAMILIAS, 'CREATE', '');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
  });

  it('filtra só UPDATE', () => {
    const out = filtrarFamilias(FAMILIAS, 'UPDATE', '');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('b');
  });

  it('filtra avisos (precoAbaixo20pc=true)', () => {
    const out = filtrarFamilias(FAMILIAS, 'avisos', '');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('b');
  });

  it('busca por código PAI (substring)', () => {
    const out = filtrarFamilias(FAMILIAS, 'todos', '1001');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
  });

  it('busca por título (case-insensitive)', () => {
    const out = filtrarFamilias(FAMILIAS, 'todos', 'azul');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('b');
  });

  it('busca por código de variação (filho) retorna a família correspondente', () => {
    const out = filtrarFamilias(FAMILIAS, 'todos', '222992');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
  });

  it('busca por código de variação parcial também funciona', () => {
    const out = filtrarFamilias(FAMILIAS, 'todos', '30000');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('b');
  });
});
