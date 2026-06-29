import { describe, it, expect } from 'vitest';
import { particionar } from '../particionar';

const c = (sku: string, cor: string) => ({ sku, cor });

describe('particionar', () => {
  it('tudo numa partição quando ≤100 cores', () => {
    const cores = Array.from({ length: 50 }, (_, i) => c(`s${i}`, `cor${i}`));
    const r = particionar(cores, new Map(), 100);
    expect(new Set(r.values())).toEqual(new Set([0]));
    expect(r.size).toBe(50);
  });

  it('abre 2ª partição ao passar de 100', () => {
    const cores = Array.from({ length: 150 }, (_, i) => c(`s${i}`, String(i).padStart(3, '0')));
    const r = particionar(cores, new Map(), 100);
    const p0 = [...r.values()].filter((p) => p === 0).length;
    const p1 = [...r.values()].filter((p) => p === 1).length;
    expect(p0).toBe(100);
    expect(p1).toBe(50);
  });

  it('distribui novas em ordem alfabética de cor', () => {
    // 101 cores: a 101ª alfabética cai na partição 1
    const cores = Array.from({ length: 101 }, (_, i) => c(`s${i}`, `cor-${String(i).padStart(3, '0')}`));
    const r = particionar(cores, new Map(), 100);
    // a última alfabética (cor-100) deve estar na partição 1
    const ultimo = cores.find((x) => x.cor === 'cor-100')!;
    expect(r.get(ultimo.sku)).toBe(1);
  });

  it('cor já publicada fica ancorada na sua partição (não migra)', () => {
    const cores = [c('a', 'Azul'), c('z', 'Zinco')];
    const anc = new Map([['z', 1]]);
    const r = particionar(cores, anc, 100);
    expect(r.get('z')).toBe(1);
    expect(r.get('a')).toBe(0); // nova preenche menor índice com espaço
  });

  it('cor nova vai pra próxima partição quando a 0 está cheia de ancoradas', () => {
    const ancoradas = Array.from({ length: 100 }, (_, i) => [`a${i}`, 0] as [string, number]);
    const cores = [...ancoradas.map(([sku]) => c(sku, 'x')), c('nova', 'NovaCor')];
    const r = particionar(cores, new Map(ancoradas), 100);
    expect(r.get('nova')).toBe(1);
    expect(r.get('a0')).toBe(0);
  });

  it('é idempotente quando tudo já está ancorado', () => {
    const anc = new Map([['a', 0], ['b', 0], ['c', 1]]);
    const cores = [c('a', 'A'), c('b', 'B'), c('c', 'C')];
    const r = particionar(cores, anc, 100);
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(0);
    expect(r.get('c')).toBe(1);
  });
});
