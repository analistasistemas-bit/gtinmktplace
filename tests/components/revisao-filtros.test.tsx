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
    concorrenciaCategoriaId: null,
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
    concorrenciaCategoriaId: null,
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

  it('soComCoresNovas: só famílias UPDATE com cor sem ml_variation_id e estoque', () => {
    const base = { ...FAMILIAS[1], operacao: 'UPDATE' as const };
    // Só reposição: toda cor já tem ml_variation_id → não é cor nova.
    const soReposicao: Familia = {
      ...base,
      id: 'rep',
      codigoPai: '1003',
      titulo: 'Fita Reposição',
      variacoes: [
        { codigo: '400001', cor: 'verde', corHex: '#16a34a', preco: 1, estoque: 8, mlVariationId: '900' },
      ],
    } as Familia;
    // Tem cor nova: uma variação sem ml_variation_id e com estoque.
    const comCorNova: Familia = {
      ...base,
      id: 'nova',
      codigoPai: '1004',
      titulo: 'Fita Nova',
      variacoes: [
        { codigo: '500001', cor: 'verde', corHex: '#16a34a', preco: 1, estoque: 8, mlVariationId: '901' },
        { codigo: '500002', cor: 'amarelo', corHex: '#eab308', preco: 1, estoque: 8, mlVariationId: null },
      ],
    } as Familia;
    const out = filtrarFamilias([soReposicao, comCorNova], 'todos', '', true);
    expect(out.map((f) => f.id)).toEqual(['nova']);
  });

  it('soComCoresNovas: cor nova com estoque 0 não conta (dorme)', () => {
    const semEstoque: Familia = {
      ...FAMILIAS[1],
      operacao: 'UPDATE',
      id: 'z',
      variacoes: [
        { codigo: '600001', cor: 'roxo', corHex: '#7c3aed', preco: 1, estoque: 0, mlVariationId: null },
      ],
    } as Familia;
    expect(filtrarFamilias([semEstoque], 'todos', '', true)).toHaveLength(0);
  });

  it('soComCoresNovas desligado (padrão): não filtra', () => {
    expect(filtrarFamilias(FAMILIAS, 'todos', '').length).toBe(2);
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
      concorrenciaCategoriaId: null,
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
      concorrenciaCategoriaId: null,
    };

    expect(familiaPublicavel(completa).ok).toBe(true);
    expect(familiaPublicavel(incompleta).ok).toBe(false);

    const out = filtrarFamilias([completa, incompleta], 'incompletas', '');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('d');
  });
});
