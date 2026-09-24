// Task 7 (ADR-0166 2026-09-24c): miolo puro de "Adicionar à grade" — extensão de uma matriz
// Cor × Tamanho já publicada no ML. Cobre eixos/travas derivados dos SKUs vivos e o payload que
// vai para a edge `adicionar-variacoes-familia` (mesmo contrato da Task 5, sem `codigo`).
import { describe, it, expect } from 'vitest';
import { chaveGrade } from '@/lib/cadastro-grade';
import { eixosExistentes, bloqueadasDe, fotoHerdavel, payloadEstender } from '@/lib/estender-grade';

// R3 do controlador: `SkuExistente` ganhou `excluida: boolean` — as fixtures deste arquivo
// recebem `excluida: false` (nenhum SKU excluído do anúncio no cenário base).
const skus = [
  { codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true, excluida: false },
  { codigo: '00000002', cor: 'Preto', tamanho: 'M', estoque: 8, temFoto: true, excluida: false },
  { codigo: '00000003', cor: 'Azul', tamanho: 'P', estoque: 0, temFoto: false, excluida: false },
];

it('eixos e bloqueadas vêm dos SKUs vivos', () => {
  expect([...eixosExistentes(skus).cores]).toEqual(['Preto', 'Azul']);
  expect(bloqueadasDe(skus).get(chaveGrade('Preto', 'M'))).toEqual({ estoque: 8 });
});

it('foto herdável: menor código COM foto da mesma cor; cor sem foto ou nova → null', () => {
  expect(fotoHerdavel('Preto', skus)).toBe('00000001');
  expect(fotoHerdavel('Azul', skus)).toBeNull();
  expect(fotoHerdavel('Verde', skus)).toBeNull();
});

it('payload: herda foto quando a linha não tem foto própria e a cor tem foto; senão usa o upload', () => {
  const base = { preco: '10', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '', gtin: '', estoqueInicial: '3' };
  const r = payloadEstender([
    { clientId: 'a', cor: 'Preto', tamanho: 'G', foto: null, ...base },
    { clientId: 'b', cor: 'Verde', tamanho: 'P', foto: new File(['x'], 'v.jpg'), ...base },
  ] as never, skus, new Map([['b', 'u1/chave/v.jpg']]));
  expect(r[0]).toMatchObject({ nome: 'Preto', tamanho: 'G', fotoDeCodigo: '00000001', estoqueInicial: 3, preco: 10 });
  expect(r[0]).not.toHaveProperty('imagemPath');
  expect(r[1]).toMatchObject({ nome: 'Verde', tamanho: 'P', imagemPath: 'u1/chave/v.jpg' });
  expect(r[1]).not.toHaveProperty('fotoDeCodigo');
  expect(r.every((v) => !('codigo' in v))).toBe(true);
});

describe('bloqueadasDe', () => {
  // Excluída fica travada também (edge recusa o par), com rótulo distinto na matriz — o miolo só
  // precisa carregar a flag para a UI decidir o texto.
  it('SKU excluído entra com excluida: true', () => {
    const comExcluida = [...skus, { codigo: '00000004', cor: 'Azul', tamanho: '38', estoque: 3, temFoto: true, excluida: true }];
    expect(bloqueadasDe(comExcluida).get(chaveGrade('Azul', '38'))).toEqual({ estoque: 3, excluida: true });
  });
});

describe('fotoHerdavel', () => {
  it('ignora SKU excluído mesmo sendo o de menor código com foto', () => {
    const comExcluida = [
      { codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true, excluida: true },
      { codigo: '00000002', cor: 'Preto', tamanho: 'M', estoque: 8, temFoto: true, excluida: false },
    ];
    expect(fotoHerdavel('Preto', comExcluida)).toBe('00000002');
  });
});
