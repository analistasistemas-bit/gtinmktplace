import { describe, expect, it } from 'vitest';
import { calcularReposicao, type EntradaCalculo, type MovDia } from '../calculo';

// Loja grande sintética (3.400 SKUs × 60 dias): o GET e o job diário rodam numa edge com ~2 s de CPU.
const HOJE = '2026-11-16';

function addDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** PRNG com semente (mulberry32): mesma entrada em toda execução. */
function prng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lojaGrande(): EntradaCalculo {
  const r = prng(42);
  const e: EntradaCalculo = { hoje: HOJE, prazo: 15, cobertura: 30, skus: [], movs: [], kits: [], pedidosAbertos: [], multiploPorFamilia: {} };
  const cores = ['Preto', 'Azul'];
  const tams = ['P', 'M', 'G', 'GG'];
  for (let f = 0; f < 425; f++) {
    const pai = `P${f}`;
    if (f % 10 === 0) e.multiploPorFamilia[pai] = 6;
    const preco = 30 + Math.floor(r() * 100);
    for (let i = 0; i < 8; i++) {
      const codigo = `${pai}-${i}`;
      e.skus.push({
        codigo, codigoPai: pai, cor: cores[i % 2], tamanho: tams[i >> 1], estoqueHoje: Math.floor(r() * 20),
        publicadoEm: r() < 0.1 ? addDias(HOJE, -20) : '2026-01-01', naoRepor: r() < 0.02, ehKit: false, nuncaMovimentado: false,
      });
      const taxa = r() * 1.5;
      for (let d = 0; d < 60; d++) {
        const vendidas = r() < taxa / 2 ? 1 + Math.floor(r() * 2) : 0;
        const precos: number[] = Array.from({ length: vendidas }, () => (r() < 0.1 ? preco * 0.7 : preco));
        e.movs.push({ dia: addDias(HOJE, -60 + d), codigo, vendidas, precos, estoqueInicio: r() < 0.1 ? 0 : 5 } satisfies MovDia);
      }
      if (r() < 0.1) e.pedidosAbertos.push({ codigo, saldo: 1 + Math.floor(r() * 10), previstoPara: addDias(HOJE, Math.floor(r() * 40) - 5) });
    }
    if (f % 20 === 0) {
      const kit = `K${f}`;
      e.skus.push({ codigo: kit, codigoPai: `KP${f}`, cor: null, tamanho: null, estoqueHoje: 0, publicadoEm: '2026-01-01', naoRepor: false, ehKit: true, nuncaMovimentado: false });
      e.kits.push({ kitCodigo: kit, baseCodigo: `${pai}-0`, unidadesPorKit: 2 });
      for (let d = 0; d < 60; d++) {
        e.movs.push({ dia: addDias(HOJE, -60 + d), codigo: kit, vendidas: r() < 0.2 ? 1 : 0, precos: [], estoqueInicio: 3 });
      }
    }
  }
  return e;
}

/** FNV-1a 32 bits do resultado (o que a tela usa): prova de que a otimização não mudou nenhum número. */
function digest(res: ReturnType<typeof calcularReposicao>): string {
  const s = JSON.stringify([
    res.skus.map((x) => [x.codigo, x.pedir, x.pedirAntesMultiplo, x.urgencia, x.v.toFixed(9), x.aCaminho, x.chegaEm, x.diasDeEstoque]),
    res.familias.map((f) => [f.codigoPai, f.pedir, f.pedirAntesMultiplo, f.urgencia, f.tendencia?.fator.toFixed(9) ?? null]),
    res.pctEstimadoPelaFamilia.toFixed(9),
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

describe('calcularReposicao — desempenho', () => {
  it('3.400 SKUs × 60 dias em menos de 1,5 s, com o mesmo resultado de antes da otimização', () => {
    const e = lojaGrande();
    expect(e.skus.filter((s) => !s.ehKit)).toHaveLength(3400);
    const t0 = performance.now();
    const res = calcularReposicao(e);
    const ms = performance.now() - t0;
    console.info(`calcularReposicao 3.400 SKUs: ${ms.toFixed(0)} ms · digest ${digest(res)}`);
    expect(res.skus).toHaveLength(3400);
    expect(digest(res)).toBe('3596ff0e');
    expect(ms).toBeLessThan(1500);
  });
});
