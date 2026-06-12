import { describe, it, expect } from 'vitest';
import { paginar } from '@/lib/paginacao';

describe('paginar', () => {
  const itens = [1, 2, 3, 4, 5, 6, 7]; // 7 itens

  it('recorta a primeira página', () => {
    const r = paginar(itens, 1, 5);
    expect(r.itensPagina).toEqual([1, 2, 3, 4, 5]);
    expect(r.paginaAtual).toBe(1);
    expect(r.totalPaginas).toBe(2);
    expect(r.inicio).toBe(1);
    expect(r.fim).toBe(5);
    expect(r.total).toBe(7);
  });

  it('recorta a última página parcial', () => {
    const r = paginar(itens, 2, 5);
    expect(r.itensPagina).toEqual([6, 7]);
    expect(r.inicio).toBe(6);
    expect(r.fim).toBe(7);
  });

  it('clampa página acima do range para a última', () => {
    const r = paginar(itens, 99, 5);
    expect(r.paginaAtual).toBe(2);
    expect(r.itensPagina).toEqual([6, 7]);
  });

  it('clampa página 0 ou negativa para 1', () => {
    expect(paginar(itens, 0, 5).paginaAtual).toBe(1);
    expect(paginar(itens, -3, 5).paginaAtual).toBe(1);
  });

  it('lista vazia → 1 página, recorte vazio, inicio/fim 0', () => {
    const r = paginar([], 1, 5);
    expect(r.itensPagina).toEqual([]);
    expect(r.totalPaginas).toBe(1);
    expect(r.paginaAtual).toBe(1);
    expect(r.inicio).toBe(0);
    expect(r.fim).toBe(0);
    expect(r.total).toBe(0);
  });

  it('não muta a entrada', () => {
    const orig = [1, 2, 3];
    const copia = [...orig];
    paginar(orig, 1, 2);
    expect(orig).toEqual(copia);
  });
});
