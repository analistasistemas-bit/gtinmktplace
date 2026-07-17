import { describe, it, expect } from 'vitest';
import { particionarPorPreco } from '../particionar';

const c = (sku: string, cor: string, precoCentavos: number | null) => ({ sku, cor, precoCentavos });
const base = { ancoragem: new Map<string, number>(), faixaVivaPorParticao: new Map<number, number>(), somenteEstoque: false };

describe('particionarPorPreco', () => {
  it('uniforme ≤100 sem ancoragem → 1 partição (caminho comum idêntico ao atual)', () => {
    const r = particionarPorPreco({ ...base, cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1000)] });
    expect(r.conflitos).toEqual([]);
    expect([...new Set(r.mapa.values())]).toEqual([0]);
    expect(r.precoPorParticao.get(0)).toBe(1000);
  });

  it('2 preços → 2 partições, cada uma com o preço do grupo', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1200), c('C', 'Cinza', 1000)],
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('A')).toBe(r.mapa.get('C'));
    expect(r.mapa.get('A')).not.toBe(r.mapa.get('B'));
    expect(r.precoPorParticao.get(r.mapa.get('A')!)).toBe(1000);
    expect(r.precoPorParticao.get(r.mapa.get('B')!)).toBe(1200);
  });

  it('grupo de preço com >100 cores subdivide pela regra alfabética (max reduzido p/ teste)', () => {
    const cores = Array.from({ length: 5 }, (_, i) => c(`s${i}`, String(i).padStart(2, '0'), 1000));
    const r = particionarPorPreco({ ...base, cores, max: 2 });
    expect(r.conflitos).toEqual([]);
    const particoes = [...new Set(r.mapa.values())].sort();
    expect(particoes).toEqual([0, 1, 2]);
    for (const p of particoes) expect(r.precoPorParticao.get(p)).toBe(1000);
    // alfabética: s0,s1 → 0; s2,s3 → 1; s4 → 2
    expect(r.mapa.get('s0')).toBe(0);
    expect(r.mapa.get('s4')).toBe(2);
  });

  it('UPDATE "tudo" sem cruzar faixa: partição inteira reprecifica junto, sem LOUD', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1200), c('B', 'Rosa', 1200)],
      ancoragem: new Map([['A', 0], ['B', 0]]), // no ar a R$10, todas vão a R$12 juntas
    });
    expect(r.conflitos).toEqual([]);
    expect(r.precoPorParticao.get(0)).toBe(1200);
  });

  it('UPDATE "tudo" cruzando faixa (ancoradas da mesma partição com preços distintos) → conflito, ninguém migra', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1200)],
      ancoragem: new Map([['A', 0], ['B', 0]]),
    });
    expect(r.conflitos.length).toBe(1);
    expect(r.conflitos[0]).toMatch(/divergentes|dividir/i);
    expect(r.mapa.get('A')).toBe(0);
    expect(r.mapa.get('B')).toBe(0); // ancorada NÃO migra (invariante #4)
  });

  it('somenteEstoque: ancoradas com preços recalculados divergentes NÃO conflitam (nada é empurrado)', () => {
    const r = particionarPorPreco({
      ...base,
      somenteEstoque: true,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1200)],
      ancoragem: new Map([['A', 0], ['B', 0]]),
      faixaVivaPorParticao: new Map([[0, 1000]]),
    });
    expect(r.conflitos).toEqual([]);
    expect(r.precoPorParticao.get(0)).toBe(1000); // faixa viva, não o recalculado
  });

  it('desempate determinístico: cor nova cujo preço casa 2 partições vai para a de MENOR particao', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1000), c('N', 'Verde', 1000)],
      ancoragem: new Map([['A', 0], ['B', 1]]), // duas partições no ar, ambas a R$10
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('N')).toBe(0);
  });

  it('cor nova em faixa inexistente abre partição nova', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('N', 'Verde', 1500)],
      ancoragem: new Map([['A', 0]]),
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('N')).toBe(1);
    expect(r.precoPorParticao.get(1)).toBe(1500);
  });

  it('cor nova sem preço → conflito LOUD', () => {
    const r = particionarPorPreco({ ...base, cores: [c('N', 'Verde', null)] });
    expect(r.conflitos.length).toBe(1);
    expect(r.conflitos[0]).toContain('N');
  });

  it('ancoradas sem preço não conflitam sozinhas: herdam o preço único das irmãs (como hoje)', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', null)],
      ancoragem: new Map([['A', 0], ['B', 0]]),
    });
    expect(r.conflitos).toEqual([]);
    expect(r.precoPorParticao.get(0)).toBe(1000);
  });

  it('duas partições ancoradas convergindo para o mesmo preço não se fundem', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1200), c('B', 'Rosa', 1200)],
      ancoragem: new Map([['A', 0], ['B', 1]]),
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('A')).toBe(0);
    expect(r.mapa.get('B')).toBe(1);
    expect(r.precoPorParticao.get(0)).toBe(r.precoPorParticao.get(1));
  });

  it('cor nova cujo preço casa partição cheia (max) abre partição nova em vez de estourar capacidade', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('N', 'Verde', 1000)],
      ancoragem: new Map([['A', 0]]),
      max: 1,
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('N')).not.toBe(r.mapa.get('A'));
    expect(r.mapa.get('A')).toBe(0);
  });
});
