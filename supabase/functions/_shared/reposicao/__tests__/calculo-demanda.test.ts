import { describe, it, expect } from 'vitest';
import {
  calcularVelocidades,
  type EntradaCalculo,
  type MovDia,
  type SkuEntrada,
} from '../calculo';

const HOJE = '2026-11-16';

function diaAnterior(n: number): string {
  // n=1 -> 2026-11-15
  const d = new Date(Date.UTC(2026, 10, 16 - n));
  return d.toISOString().slice(0, 10);
}
/** n dias terminando em hoje-1, em ordem crescente */
function ultimosDias(n: number): string[] {
  return Array.from({ length: n }, (_, i) => diaAnterior(n - i));
}

function sku(codigo: string, extra: Partial<SkuEntrada> = {}): SkuEntrada {
  return {
    codigo, codigoPai: 'P', cor: null, tamanho: null, estoqueHoje: 5,
    publicadoEm: '2026-01-01', naoRepor: false, ehKit: false, nuncaMovimentado: false, ...extra,
  };
}
function mov(dia: string, codigo: string, vendidas: number, extra: Partial<MovDia> = {}): MovDia {
  return { dia, codigo, vendidas, precos: [], estoqueInicio: 5, ...extra };
}
function entrada(skus: SkuEntrada[], movs: MovDia[], extra: Partial<EntradaCalculo> = {}): EntradaCalculo {
  return { hoje: HOJE, prazo: 15, cobertura: 30, skus, movs, kits: [], pedidosAbertos: [], multiploPorFamilia: {}, ...extra };
}
/** vendidas por dia, em ordem crescente terminando em hoje-1 */
function serie(codigo: string, vendas: number[], extra: Partial<MovDia> = {}): MovDia[] {
  const dias = ultimosDias(vendas.length);
  return vendas.map((v, i) => mov(dias[i], codigo, v, extra));
}

describe('calcularVelocidades', () => {
  it('ruptura nao esconde demanda', () => {
    const dias = ultimosDias(13);
    const movs = dias.map((d, i) =>
      i < 4 ? mov(d, 'A', i < 3 ? 1 : 0, { estoqueInicio: 5 }) : mov(d, 'A', 0, { estoqueInicio: 0 }));
    const r = calcularVelocidades(entrada([sku('A')], movs));
    expect(r.porSku.get('A')!.propria).toBeCloseTo(0.75, 9);
  });

  it('dia antes da publicacao nao conta', () => {
    const dias = ultimosDias(29); // 2026-10-18 .. 2026-11-15
    expect(dias[0]).toBe('2026-10-18');
    const movs = dias.map((d) => mov(d, 'A', d >= '2026-11-03' ? 1 : 0));
    const r = calcularVelocidades(entrada([sku('A', { publicadoEm: '2026-11-03' })], movs));
    const v = r.porSku.get('A')!;
    expect(v.diasDisponiveis).toBe(13);
    expect(v.propria).toBeCloseTo(1, 9);
  });

  it('kit divide pelos dias do kit', () => {
    const dias = ultimosDias(20);
    const movs = [
      ...dias.map((d) => mov(d, 'B', 0)),
      ...dias.map((d, i) => (i >= 18 ? mov(d, 'K', 2) : mov(d, 'K', 0, { estoqueInicio: 0 }))),
    ];
    const r = calcularVelocidades(entrada(
      [sku('B'), sku('K', { ehKit: true })], movs,
      { kits: [{ kitCodigo: 'K', baseCodigo: 'B', unidadesPorKit: 2 }] },
    ));
    expect(r.porSku.get('B')!.propria).toBeCloseTo(4, 9);
    expect(r.porSku.get('B')!.unidades).toBe(8);
    expect(r.porSku.has('K')).toBe(false);
  });

  it('dia atipico na familia', () => {
    const r = calcularVelocidades(entrada([sku('A')], serie('A', [1, 1, 1, 12])));
    // 1+1+1+3 em 4 dias
    expect(r.porSku.get('A')!.propria).toBeCloseTo(6 / 4, 9);
  });

  it('dia atipico corta proporcional entre SKUs da familia', () => {
    const dias = ultimosDias(4);
    const movs = [
      ...[1, 1, 1, 8].map((v, i) => mov(dias[i], 'A', v)),
      ...[0, 0, 0, 4].map((v, i) => mov(dias[i], 'B', v)),
    ];
    const r = calcularVelocidades(entrada([sku('A'), sku('B')], movs));
    // total 12 > 3*1 -> teto 3, fator 0,25: A=2, B=1
    expect(r.porSku.get('A')!.propria).toBeCloseTo((1 + 1 + 1 + 2) / 4, 9);
    expect(r.porSku.get('B')!.propria).toBeCloseTo(1 / 4, 9);
    expect(r.porSku.get('A')!.picoLimitadoEm).toEqual([dias[3]]);
    expect(r.porSku.get('B')!.picoLimitadoEm).toEqual([dias[3]]);
    expect(r.porSku.get('A')!.unidades).toBeCloseTo(5, 9);
  });

  it('oferta: menos de 5 vendas usa p75 da familia', () => {
    const dias = ultimosDias(25);
    const f = dias.map((d) => mov(d, 'F', 1, { precos: [100] }));
    const x = dias.slice(0, 3).map((d) => mov(d, 'X', 1, { precos: [50] }));
    const r = calcularVelocidades(entrada([sku('F'), sku('X')], [...f, ...x]));
    expect(r.porSku.get('X')!.vendasEmOferta).toBe(3);
  });

  it('oferta: 5+ vendas usa p75 do proprio SKU', () => {
    const dias = ultimosDias(25);
    const f = dias.map((d) => mov(d, 'F', 1, { precos: [100] }));
    const x = dias.slice(0, 5).map((d) => mov(d, 'X', 1, { precos: [50] }));
    const r = calcularVelocidades(entrada([sku('F'), sku('X')], [...f, ...x]));
    expect(r.porSku.get('X')!.vendasEmOferta).toBe(0);
  });

  it('oferta: criterio conta vendas, nao precos recebidos', () => {
    const dias = ultimosDias(25);
    const f = dias.map((d) => mov(d, 'F', 1, { precos: [100] }));
    const x = [mov(dias[0], 'X', 5, { precos: [50] })]; // 5 vendas, 1 preco
    const r = calcularVelocidades(entrada([sku('F'), sku('X')], [...f, ...x]));
    expect(r.porSku.get('X')!.vendasEmOferta).toBe(0);
  });

  it('movs duplicados no mesmo (codigo, dia) lancam erro', () => {
    const d = ultimosDias(1)[0];
    expect(() => calcularVelocidades(entrada([sku('A')], [mov(d, 'A', 1), mov(d, 'A', 2)]))).toThrow(/duplicado/);
  });

  it('campanha longa marcada', () => {
    const movs = ultimosDias(60).map((d, i) => mov(d, 'A', 1, { precos: [i < 30 ? 100 : 80] }));
    const r = calcularVelocidades(entrada([sku('A')], movs));
    expect(r.porSku.get('A')!.vendasEmOferta).toBe(30);
  });

  it('oferta sai do denominador da tendencia', () => {
    // 14 dias antigos: 5 un a 100; 14 recentes: 4 dias de oferta (5 un a 50), 10 dias com 1 un a 100
    const antigos = Array.from({ length: 14 }, () => ({ v: 5, p: 100 }));
    const recentes = [
      ...Array.from({ length: 4 }, () => ({ v: 5, p: 50 })),
      ...Array.from({ length: 10 }, () => ({ v: 1, p: 100 })),
    ];
    const dias = ultimosDias(28);
    const movs = [...antigos, ...recentes].map((x, i) =>
      mov(dias[i], 'A', x.v, { precos: Array(x.v).fill(x.p) }));
    const r = calcularVelocidades(entrada([sku('A')], movs));
    const t = r.tendenciaPorFamilia.get('P')!;
    const base = 80 / 24;
    expect(r.porSku.get('A')!.vendasEmOferta).toBe(20);
    expect((t.variacaoVendas + 1) * base).toBeCloseTo(1.0, 9); // recente = 1,0
  });

  it('fator 1,2 aplicado uma vez', () => {
    const vendas = [...Array(14).fill(0.6), ...Array(14).fill(1.4)];
    const r = calcularVelocidades(entrada([sku('A')], serie('A', vendas)));
    const t = r.tendenciaPorFamilia.get('P')!;
    expect(t.fator).toBeCloseTo(1.2, 9);
    expect(r.porSku.get('A')!.usada).toBeCloseTo(1, 9); // sem o fator
  });

  it('mistura cria parcela para quem nao vendeu', () => {
    const skus = [
      sku('11', { cor: 'c1', tamanho: 't1' }), sku('12', { cor: 'c1', tamanho: 't2' }),
      sku('21', { cor: 'c2', tamanho: 't1' }), sku('22', { cor: 'c2', tamanho: 't2' }),
    ];
    const dias = ultimosDias(13);
    const vendas: Record<string, number[]> = { '11': [1, 1, 1], '22': [1] };
    const movs = skus.flatMap((s) => dias.map((d, i) => mov(d, s.codigo, vendas[s.codigo]?.[i] ?? 0)));
    const r = calcularVelocidades(entrada(skus, movs));
    expect(r.porSku.get('12')!.usada).toBeGreaterThan(0);
    const soma = [...r.porSku.values()].reduce((a, v) => a + v.usada, 0);
    expect(soma).toBeCloseTo(4 / 13, 9);
  });

  it('sku recem-criado (cor nova) e cor encalhada', () => {
    const skus = [
      sku('11', { cor: 'c1', tamanho: 't1' }), sku('12', { cor: 'c1', tamanho: 't2' }),
      sku('NOVO', { cor: 'c2', tamanho: 't1', publicadoEm: null }),
      sku('ENC', { cor: 'c3', tamanho: 't1' }),
    ];
    const dias = ultimosDias(20);
    const movs = ['11', '12', 'ENC'].flatMap((c) =>
      dias.map((d, i) => mov(d, c, c !== 'ENC' && i < 4 ? 1 : 0)));
    const r = calcularVelocidades(entrada(skus, movs));
    const n = r.porSku.get('NOVO')!;
    expect(n.w).toBe(0);
    expect(n.usada).toBeGreaterThan(0);
    expect(r.porSku.get('ENC')!.usada).toBe(0); // 20 dias, 0 vendas: encalhe real
    const soma = [...r.porSku.values()].reduce((a, v) => a + v.usada, 0);
    expect(soma).toBeCloseTo(8 / 20, 9);
  });

  it('tendencia so com 28 dias', () => {
    const vendas27 = [...Array(13).fill(0.6), ...Array(14).fill(1.4)];
    expect(calcularVelocidades(entrada([sku('A')], serie('A', vendas27))).tendenciaPorFamilia.get('P')).toBeNull();
  });

  it('esfriando', () => {
    const vendas = [...Array(14).fill(0.7), ...Array(14).fill(0.3)];
    const t = calcularVelocidades(entrada([sku('A')], serie('A', vendas))).tendenciaPorFamilia.get('P')!;
    expect(t.fator).toBeCloseTo(0.8, 9);
  });

  it('esfriando exige base de 5', () => {
    const vendas = [...Array(14).fill(0.6), ...Array(14).fill(0)];
    expect(calcularVelocidades(entrada([sku('A')], serie('A', vendas))).tendenciaPorFamilia.get('P')).toBeNull();
  });
});
