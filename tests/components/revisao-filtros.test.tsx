import { describe, it, expect } from 'vitest';
import { filtrarFamilias } from '@/pages/Revisao';
import { familiaPublicavel } from '@/lib/publicavel';
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

  it('filtra incompletas — retorna só famílias não-publicáveis', () => {
    const varOk = {
      codigo: '00010001',
      cor: 'Vermelho',
      corHex: '#dc2626',
      corOrigem: 'descricao' as const,
      corEditadaPeloOperador: false,
      preco: 1,
      precoPublicacao: 1,
      estoque: 10,
      gtin: null,
      fotoPath: 'u/l/001.jpeg',
      excluidaDaPublicacao: false,
    };

    const completa: Familia = {
      id: 'c',
      loteId: 'lote-42',
      codigoPai: '2001',
      titulo: 'Linha Completa',
      descricao: '',
      operacao: 'CREATE',
      estrategiaPreco: 'PROPRIO',
      estrategiaMotivo: '',
      concorrencia: 'sem',
      concorrenciaVendedores: 0,
      concorrenciaPrecoMin: null,
      analiseMercado: null,
      tipoAviamento: 'linha',
      categoriaMlId: 'MLB270273',
      precoMin: 1,
      precoMax: 1,
      precoAbaixo20pc: false,
      capaStoragePath: null,
      variacoes: [varOk],
      status: 'pronto',
      tokensInput: null,
      tokensOutput: null,
      custoCentavos: null,
      tituloEditadoPeloOperador: false,
      descricaoEditadaPeloOperador: false,
      variacoesSemCor: 0,
    };

    const incompleta: Familia = {
      id: 'd',
      loteId: 'lote-42',
      codigoPai: '2002',
      titulo: 'Linha Incompleta',
      descricao: '',
      operacao: 'CREATE',
      estrategiaPreco: 'PROPRIO',
      estrategiaMotivo: '',
      concorrencia: 'sem',
      concorrenciaVendedores: 0,
      concorrenciaPrecoMin: null,
      analiseMercado: null,
      tipoAviamento: 'outro',
      categoriaMlId: null,
      precoMin: 1,
      precoMax: 1,
      precoAbaixo20pc: false,
      capaStoragePath: null,
      variacoes: [varOk],
      status: 'pronto',
      tokensInput: null,
      tokensOutput: null,
      custoCentavos: null,
      tituloEditadoPeloOperador: false,
      descricaoEditadaPeloOperador: false,
      variacoesSemCor: 0,
    };

    expect(familiaPublicavel(completa).ok).toBe(true);
    expect(familiaPublicavel(incompleta).ok).toBe(false);

    const out = filtrarFamilias([completa, incompleta], 'incompletas', '');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('d');
  });
});
