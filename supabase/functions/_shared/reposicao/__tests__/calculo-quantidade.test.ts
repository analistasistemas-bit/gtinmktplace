import { describe, expect, it } from 'vitest';
import {
  calcularReposicao,
  fecharFamilia,
  projetarSku,
  quantilPoisson,
  type EntradaCalculo,
  type MovDia,
  type PedidoAberto,
} from '../calculo';

const HOJE = '2026-11-16';
const PRAZO = 15;
const COB = 30;

function addDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 60 dias de venda contínua com velocidade ~v (SKU sempre disponível, sem preço de oferta). */
function movsComV(codigo: string, v: number): MovDia[] {
  return Array.from({ length: 60 }, (_, i) => ({
    dia: addDias(HOJE, -60 + i),
    codigo,
    vendidas: Math.floor((i + 1) * v + 1e-9) - Math.floor(i * v + 1e-9),
    precos: [],
    estoqueInicio: 10,
  }));
}

function entrada(v: number, estoque: number, pedidos: PedidoAberto[] = [], codigo = 'A1'): EntradaCalculo {
  return {
    hoje: HOJE, prazo: PRAZO, cobertura: COB,
    skus: [{ codigo, codigoPai: 'P', cor: null, tamanho: null, estoqueHoje: estoque, publicadoEm: '2026-01-01', naoRepor: false, ehKit: false, nuncaMovimentado: false }],
    movs: movsComV(codigo, v), kits: [], pedidosAbertos: pedidos, multiploPorFamilia: {},
  };
}

const proj = (v: number, estoqueHoje: number, pedidos: PedidoAberto[] = []) =>
  projetarSku({ v, estoqueHoje, pedidos, hoje: HOJE, prazo: PRAZO, cobertura: COB });

describe('quantilPoisson', () => {
  it('casos conhecidos', () => {
    expect(quantilPoisson(0, 0.85)).toBe(0);
    expect(quantilPoisson(30, 0.85)).toBe(36);
    expect(quantilPoisson(0.15, 0.85)).toBe(0);
    expect(quantilPoisson(1000, 0.85)).toBe(Math.ceil(1000 + 1.0364 * Math.sqrt(1000)));
  });
});

describe('aceites do ADR-0207', () => {
  it('aceite 1 — aprovar nao gera nova sugestao', () => {
    // helpers puros
    const p = proj(1, 0);
    expect(p.falta).toBe(30);
    expect(fecharFamilia([{ codigo: 'A1', v: 1, falta: p.falta, vendeu30: true, ePrazo: p.E[PRAZO], naoRepor: false }], COB, 1).get('A1')!.pedir).toBe(36);
    const pedido = { codigo: 'A1', saldo: 36, previstoPara: '2026-12-01' };
    const q = proj(1, 0, [pedido]);
    expect(q.falta).toBe(0);
    expect(fecharFamilia([{ codigo: 'A1', v: 1, falta: q.falta, vendeu30: true, ePrazo: q.E[PRAZO], naoRepor: false }], COB, 1).get('A1')!.pedir).toBe(0);
    // composição ponta a ponta
    const sem = calcularReposicao(entrada(1, 0));
    expect(sem.skus[0].v).toBeCloseTo(1, 9);
    expect(sem.skus[0].pedir).toBe(36);
    const com = calcularReposicao(entrada(1, 0, [pedido]));
    expect(com.skus[0].pedir).toBe(0);
    expect(com.skus[0].aCaminho).toBe(36);
    expect(com.skus[0].chegaEm).toBe('2026-12-01');
  });

  it('aceite 2 — pedir > 0 nunca e em_dia', () => {
    const casos: [number, number, string][] = [
      [0.15, 0, 'ruptura'], [0.15, 5, 'pedir_agora'], [0.15, 40, 'em_dia'],
      [1, 0, 'ruptura'], [1, 5, 'vai_faltar'], [1, 40, 'pedir_agora'],
    ];
    for (const [v, est, urg] of casos) {
      const r = calcularReposicao(entrada(v, est)).skus[0];
      if (r.pedir > 0) expect(r.urgencia, `v=${v} est=${est}`).not.toBe('em_dia');
      expect(r.urgencia, `v=${v} est=${est}`).toBe(urg);
    }
    // o caso em_dia realmente tem pedir 0 e os demais pedir > 0
    expect(calcularReposicao(entrada(0.15, 40)).skus[0].pedir).toBe(0);
    expect(calcularReposicao(entrada(1, 40)).skus[0].pedir).toBeGreaterThan(0);
  });

  it('aceite 3 — soma fecha com multiplo', () => {
    const vs = [0.07, 0.1, 0.07, 0.03];
    const itens = vs.map((v, i) => ({ codigo: `S${i}`, v, falta: v * COB, vendeu30: true, ePrazo: 0, naoRepor: false }));
    const r = fecharFamilia(itens, COB, 6);
    const soma = [...r.values()].reduce((a, x) => a + x.pedir, 0);
    const antes = [...r.values()][0].antes; // mesmo valor para a família inteira
    expect(antes).toBe(11);
    expect(soma).toBe(12);
    expect(soma % 6).toBe(0);
    for (const x of r.values()) expect(Number.isInteger(x.pedir)).toBe(true);
  });
});

describe('rodada 1 — arredondamento e multiplo', () => {
  const item = (codigo: string, v: number, falta: number, ePrazo = 0, vendeu30 = true) =>
    ({ codigo, v, falta, vendeu30, ePrazo, naoRepor: false });

  it.each([0.05, 0.07, 0.1, 0.12, 0.15, 0.2, 0.25])('aceite 1 com 2 SKUs (v = [1; %s]): aprovar exatamente o pedir zera a sugestao', (vB) => {
    const e = entrada(1, 0);
    e.skus.push({ ...e.skus[0], codigo: 'A2' });
    e.movs.push(...movsComV('A2', vB));
    const r = calcularReposicao(e);
    const previsto = addDias(HOJE, 15);
    e.pedidosAbertos = r.skus.map((s) => ({ codigo: s.codigo, saldo: s.pedir, previstoPara: previsto }));
    const depois = calcularReposicao(e);
    expect(depois.skus.map((s) => s.pedir)).toEqual([0, 0]);
    expect(depois.familias[0].pedir).toBe(0);
  });

  it('piso: cada SKU recebe ao menos ceil(falta)', () => {
    const r = fecharFamilia([item('A', 1, 30), item('B', 0.07, 2.1)], COB, 1);
    expect(r.get('B')!.pedir).toBeGreaterThanOrEqual(3);
    expect(r.get('A')!.pedir).toBeGreaterThanOrEqual(30);
  });

  it('excedente do multiplo nao vai para SKU com v = 0', () => {
    const r = fecharFamilia([item('A', 0.05, 1.5), item('B', 0, 0, 40, false), item('C', 0, 0, 40, false)], COB, 12);
    expect([r.get('A')!.pedir, r.get('B')!.pedir, r.get('C')!.pedir]).toEqual([12, 0, 0]);
  });

  it('desempate do maior resto pela maior v', () => {
    // Λ = 9 → folga 3 repartida 1:2 → alvos 3,5 e 4,5 (mesmo resto); sobra 1 vai para o de maior v
    const r = fecharFamilia([item('A', 0.1, 2.5), item('B', 0.2, 2.5)], COB, 1);
    expect([r.get('A')!.pedir, r.get('B')!.pedir]).toEqual([3, 5]);
  });

  it('sobra do multiplo maior que o numero de SKUs, na proporcao de v', () => {
    const r = fecharFamilia([item('A', 1, 30), item('B', 1, 30)], COB, 100);
    expect([r.get('A')!.pedir, r.get('B')!.pedir]).toEqual([50, 50]);
  });

  it('multiploPorFamilia via calcularReposicao; antes do multiplo e por SKU', () => {
    const e = entrada(1, 0);
    e.multiploPorFamilia = { P: 10 };
    const r = calcularReposicao(e);
    expect(r.skus[0].pedir).toBe(40);
    expect(r.skus[0].pedirAntesMultiplo).toBe(36);
    expect(r.familias[0].pedirAntesMultiplo).toBe(36);
    expect(r.familias[0].pedir).toBe(40);
  });

  it('multiplo invalido vira 1', () => {
    for (const m of [0, -3, NaN, Infinity]) {
      expect(fecharFamilia([item('A', 1, 30)], COB, m).get('A')!.pedir).toBe(36);
    }
  });
});

describe('quantidade', () => {
  const um = (v: number, falta: number, ePrazo: number, vendeu30 = true) =>
    fecharFamilia([{ codigo: 'A', v, falta, vendeu30, ePrazo, naoRepor: false }], COB, 1).get('A')!;

  it('poisson protege', () => {
    expect(um(1, 30, 0).pedir).toBe(36); // não 30
  });

  it('poisson de media baixa', () => {
    expect(um(0.005, 0.15, 0).pedir).toBe(1); // mínimo 1
    expect(um(0.005, 0, 0).pedir).toBe(1); // sem falta, mas vendeu e zera no prazo: mínimo 1 manda
    expect(um(0.005, 0, 0, false).pedir).toBe(0); // sem venda em 30 dias e sem falta: nada
  });

  it('sobra de um tamanho nao cobre outro', () => {
    const a = proj(0.5, 0);
    const b = proj(0.5, 50);
    expect(a.falta).toBe(15);
    expect(b.falta).toBe(0);
    const r = fecharFamilia([
      { codigo: 'A', v: 0.5, falta: a.falta, vendeu30: true, ePrazo: a.E[PRAZO], naoRepor: false },
      { codigo: 'B', v: 0.5, falta: b.falta, vendeu30: true, ePrazo: b.E[PRAZO], naoRepor: false },
    ], COB, 1);
    expect(r.get('A')!.pedir).toBe(21);
    expect(r.get('B')!.pedir).toBe(0);
  });

  it('previsto para hoje chega', () => {
    const p = proj(1, 0, [{ codigo: 'A1', saldo: 50, previstoPara: HOJE }]);
    expect(p.E[1]).toBe(50); // chegou em d = 1
    expect(p.E[PRAZO]).toBe(36);
    expect(p.falta).toBe(0);
    expect(calcularReposicao(entrada(1, 0, [{ codigo: 'A1', saldo: 50, previstoPara: HOJE }])).skus[0].pedir).toBe(0);
    // com saldo 36 faltam 8 de cobertura e a folga de 6 vai inteira no SKU: 14
    expect(proj(1, 0, [{ codigo: 'A1', saldo: 36, previstoPara: HOJE }]).falta).toBe(8);
  });

  it('atrasado chega amanha', () => {
    const pedido = { codigo: 'A1', saldo: 40, previstoPara: '2026-11-10' };
    const p = proj(0.5, 2, [pedido]);
    expect(p.E[1]).toBe(41.5);
    expect(p.diasDeEstoque).toBeNull();
    const r = calcularReposicao(entrada(0.5, 2, [pedido])).skus[0];
    expect(r.pedir).toBe(0);
    expect(r.urgencia).toBe('em_dia');
    // sem o pedido, o mesmo estoque zera antes do prazo
    expect(calcularReposicao(entrada(0.5, 2)).skus[0].urgencia).toBe('vai_faltar');
  });

  it('chegadas depois do prazo entram em disp', () => {
    // chega em d = 20 (> prazo): E_15 = 0, disp = 0 + 40
    const p = proj(1, 0, [{ codigo: 'A1', saldo: 40, previstoPara: addDias(HOJE, 20) }]);
    expect(p.E[PRAZO]).toBe(0);
    expect(p.disp).toBe(40);
    expect(p.falta).toBe(0);
    expect(p.diasDeEstoque).toBe(0);
  });

  it('familia sem venda', () => {
    const e = entrada(0, 0);
    e.skus.push({ ...e.skus[0], codigo: 'A2', estoqueHoje: 3 });
    const r = calcularReposicao(e);
    for (const s of r.skus) {
      expect(s.pedir).toBe(0);
      expect(s.urgencia).toBe('em_dia');
      expect(Number.isNaN(s.v)).toBe(false);
    }
    expect(r.familias[0].pedir).toBe(0);
    expect(r.familias[0].urgencia).toBe('em_dia');
    expect(r.pctEstimadoPelaFamilia).toBe(0);
  });

  it('nao repor', () => {
    const e = entrada(1, 0);
    e.skus.push({ ...e.skus[0], codigo: 'A2', naoRepor: true });
    e.movs.push(...movsComV('A2', 1));
    const r = calcularReposicao(e);
    const a2 = r.skus.find((s) => s.codigo === 'A2')!;
    expect(a2.pedir).toBe(0);
    expect(a2.usada).toBe(0); // fora da curva: a família inteira vai para A1
    expect(r.skus.find((s) => s.codigo === 'A1')!.pedir).toBe(36);
    const f = fecharFamilia([{ codigo: 'X', v: 1, falta: 30, vendeu30: true, ePrazo: 0, naoRepor: true }], COB, 1);
    expect(f.get('X')!.pedir).toBe(0);
  });
});

describe('completar grade (emenda 17/11): SKU nunca movimentado', () => {
  const sku = (codigo: string, cor: string, tamanho: string, extra: Record<string, unknown> = {}) => ({
    codigo, codigoPai: 'P', cor, tamanho, estoqueHoje: 0, publicadoEm: '2026-01-01', naoRepor: false, ehKit: false,
    nuncaMovimentado: false, ...extra,
  });
  /** A e B vendem; N nunca teve movimento (MovDia sem venda e saldo 0, como monta o dados.ts). */
  function familia(comN: boolean, extraN: Record<string, unknown> = {}): EntradaCalculo {
    const skus = [sku('A', 'Preto', 'P', { estoqueHoje: 1 }), sku('B', 'Preto', 'M')];
    const movs = [...movsComV('A', 0.1), ...movsComV('B', 0.05)];
    if (comN) {
      skus.push(sku('N', 'Azul', 'G', { nuncaMovimentado: true, ...extraN }));
      movs.push(...movsComV('N', 0).map((m) => ({ ...m, estoqueInicio: 0 })));
    }
    return { hoje: HOJE, prazo: PRAZO, cobertura: COB, skus, movs, kits: [], pedidosAbertos: [], multiploPorFamilia: {} };
  }

  it('fora da curva e da reescala: pedir 0, em_dia, completarGrade ≥ 1; os outros SKUs não mudam', () => {
    const com = calcularReposicao(familia(true));
    const sem = calcularReposicao(familia(false));
    const n = com.skus.find((s) => s.codigo === 'N')!;
    expect(n.pedir).toBe(0);
    expect(n.v).toBe(0);
    expect(n.urgencia).toBe('em_dia');
    // cor e tamanho novos: share médio (1/1 × 1/2) × vFamília 0,15 × 30 = 2,25 → 3
    expect(n.completarGrade).toBe(3);
    for (const c of ['A', 'B']) {
      const a = com.skus.find((s) => s.codigo === c)!;
      const b = sem.skus.find((s) => s.codigo === c)!;
      expect(a.v).toBe(b.v);
      expect(a.pedir).toBe(b.pedir);
      expect(a.urgencia).toBe(b.urgencia);
      expect(a.completarGrade).toBe(0);
    }
    expect(com.familias[0].pedir).toBe(sem.familias[0].pedir);
    expect(com.familias[0].urgencia).toBe(sem.familias[0].urgencia);
    expect(com.familias[0].pedir).toBe(com.skus.reduce((a, s) => a + s.pedir, 0)); // sem o completarGrade
  });

  it('mesmo com estoque de planilha (dias disponíveis), não entra na curva', () => {
    const com = calcularReposicao(familia(true, { estoqueHoje: 4 }));
    const sem = calcularReposicao(familia(false));
    for (const c of ['A', 'B']) expect(com.skus.find((s) => s.codigo === c)!.v).toBe(sem.skus.find((s) => s.codigo === c)!.v);
    expect(com.skus.find((s) => s.codigo === 'N')!.urgencia).toBe('em_dia');
  });

  it('valor existente entre os elegíveis usa o share dele; família sem venda dá 0; Não repor dá 0', () => {
    // N em Preto (share 1) e tamanho P (share de A = 0,1 / 0,15): 1 × 2/3 × 0,15 × 30 = 3
    expect(calcularReposicao(familia(true, { cor: 'Preto', tamanho: 'P' })).skus.find((s) => s.codigo === 'N')!.completarGrade).toBe(3);
    const parada = familia(true);
    parada.movs = parada.movs.map((m) => ({ ...m, vendidas: 0 }));
    expect(calcularReposicao(parada).skus.find((s) => s.codigo === 'N')!.completarGrade).toBe(0);
    expect(calcularReposicao(familia(true, { naoRepor: true })).skus.find((s) => s.codigo === 'N')!.completarGrade).toBe(0);
  });

  it('SKU que teve estoque e zerou (com movimento) continua Ruptura', () => {
    const r = calcularReposicao(entrada(1, 0)).skus[0];
    expect(r.urgencia).toBe('ruptura');
    expect(r.completarGrade).toBe(0);
  });
});
