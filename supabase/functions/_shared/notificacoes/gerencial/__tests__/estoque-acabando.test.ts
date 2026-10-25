import { describe, expect, it } from 'vitest';
import { coberturaResumo, selecionarEstoqueAcabando, type CatalogoEstoque } from '../estoque-acabando.ts';
import { nomeSku } from '../nome-sku.ts';
import type { ResultadoItem } from '../resultado.ts';
import { coberturaDias } from '../../../../../../src/lib/vendas-sku';

const FIM = '2026-10-25T03:00:00.000Z';
const H = 3_600_000;
const D = 24 * H;
const fimMs = Date.parse(FIM);
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 1;
type Cfg = { codigo: string; estoque?: number | null; ehKit?: boolean; lucro?: number | null; un?: number; dias?: number[]; datas?: string[]; nome?: string | null; fam?: string | null; semCatalogo?: boolean };
// dias = deslocamentos (em dias) antes do fim; uma venda por dia, somando `un` unidades
function monta(cfgs: Cfg[]) {
  const itens: ResultadoItem[] = [];
  const datas = new Map<number, string>();
  const catalogo = new Map<string, CatalogoEstoque>();
  for (const c of cfgs) {
    const vendas = c.datas ?? (c.dias ?? [1, 2, 3]).map((d) => iso(fimMs - d * D - H));
    vendas.forEach((data, i) => {
      const orderId = seq++;
      datas.set(orderId, data);
      itens.push({
        orderId, packChave: String(orderId), codigo: c.codigo, titulo: c.codigo, quantidade: i === 0 ? (c.un ?? 3) - (vendas.length - 1) : 1,
        venda: 0, liquido: 0, imposto: 0, impostoOk: true, custo: 0, custoEstimado: false, faturavel: true, freteNaoLido: false,
        lucro: c.lucro === undefined ? 10 / vendas.length : c.lucro === null ? null : c.lucro / vendas.length,
      });
    });
    if (!c.semCatalogo) {
      catalogo.set(c.codigo, { codigo: c.codigo, estoque: c.estoque === undefined ? 1 : c.estoque, ehKit: !!c.ehKit, nome: c.nome ?? null, nomeFamilia: c.fam ?? null });
    }
  }
  return { itens, datas, catalogo };
}
const sel = (cfgs: Cfg[]) => {
  const m = monta(cfgs);
  return selecionarEstoqueAcabando(m.itens, m.datas, m.catalogo, FIM);
};

describe('estoque acabando', () => {
  it('fórmula de cobertura = coberturaDias da tela', () => {
    for (const [e, u] of [[12, 90], [30, 30], [100, 30], [7, 45]]) expect(coberturaResumo(e, u)).toBe(coberturaDias(e, u, false));
    expect(coberturaResumo(-2, 30)).toBe(0);
  });

  it('seletor usa a fórmula', () => {
    const r = sel([{ codigo: 'A', estoque: 12, un: 90 }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ codigo: 'A', cobertura: 4, zerado: false, estoque: 12, porDia: 3 });
    expect(r[0].lucro30).toBeCloseTo(10);
  });

  it('só campeões: top 20 por lucro 30d', () => {
    const cfgs = Array.from({ length: 25 }, (_, i) => ({ codigo: `S${String(i).padStart(2, '0')}`, estoque: 1, un: 30, lucro: 100 + i }));
    const r = sel(cfgs).map((x) => x.codigo);
    expect(r).toHaveLength(20);
    expect(r).not.toContain('S00');
    expect(r).toContain('S05');
  });

  it('kit sai antes do ranking', () => {
    const cfgs: Cfg[] = Array.from({ length: 21 }, (_, i) => ({ codigo: `S${String(i).padStart(2, '0')}`, estoque: 1, un: 30, lucro: 100 + i }));
    cfgs.push({ codigo: 'KIT', ehKit: true, estoque: 1, un: 30, lucro: 9999 });
    const r = sel(cfgs).map((x) => x.codigo);
    expect(r).not.toContain('KIT');
    expect(r).toHaveLength(20);
    expect(r).toContain('S01');
  });

  it('venda em menos de 3 dias distintos fica fora', () => {
    const mesmoDia = [1, 2, 3].map((k) => iso(fimMs - D - k * 60_000));
    expect(sel([{ codigo: 'A', estoque: 1, un: 30, datas: mesmoDia }])).toHaveLength(0);
    expect(sel([{ codigo: 'A', estoque: 1, un: 30, dias: [1, 2, 3] }])).toHaveLength(1);
  });

  it('dispara só abaixo de 7 dias', () => {
    // 30 un/30d => 1/dia
    expect(sel([{ codigo: 'A', estoque: 6, un: 30 }])).toHaveLength(1);
    expect(sel([{ codigo: 'A', estoque: 7, un: 30 }])).toHaveLength(0);
  });

  it('zerado com venda nos últimos 7 dias entra; há mais de 7 dias sai', () => {
    const com = (ultimo: number) => sel([{ codigo: 'A', estoque: 0, dias: [ultimo, 20, 21] }]);
    expect(com(6)).toHaveLength(1);
    expect(com(8)).toHaveLength(0);
    const exata = [iso(fimMs - 7 * D), iso(fimMs - 20 * D), iso(fimMs - 21 * D)];
    expect(sel([{ codigo: 'A', estoque: 0, datas: exata }])).toHaveLength(1);
  });

  it('zerado antigo não entra pela cobertura', () => {
    expect(sel([{ codigo: 'A', estoque: 0, dias: [10, 20, 21] }])).toHaveLength(0);
  });

  it('20º lugar empatado desempata por código', () => {
    const cfgs: Cfg[] = Array.from({ length: 19 }, (_, i) => ({ codigo: `A${String(i).padStart(2, '0')}`, estoque: 1, un: 30, lucro: 500 }));
    cfgs.push({ codigo: 'Z', estoque: 1, un: 30, lucro: 100 }, { codigo: 'B', estoque: 1, un: 30, lucro: 100 });
    const r = sel(cfgs).map((x) => x.codigo);
    expect(r).toContain('B');
    expect(r).not.toContain('Z');
  });

  it('estoque negativo vira zerado', () => {
    const r = sel([{ codigo: 'A', estoque: -2, dias: [1, 2, 3] }]);
    expect(r[0]).toMatchObject({ zerado: true, cobertura: 0, estoque: -2 });
  });

  it('fora: sem lucro calculado, sem catálogo, estoque nulo', () => {
    expect(sel([
      { codigo: 'A', estoque: 1, lucro: null },
      { codigo: 'B', estoque: 1, semCatalogo: true },
      { codigo: 'C', estoque: null },
    ])).toHaveLength(0);
  });

  it('ordem: zerados primeiro (por lucro), depois menor cobertura', () => {
    const r = sel([
      { codigo: 'C5', estoque: 5, un: 30, lucro: 900 },
      { codigo: 'C2', estoque: 2, un: 30, lucro: 800 },
      { codigo: 'Z1', estoque: 0, lucro: 100 },
      { codigo: 'Z2', estoque: 0, lucro: 200 },
    ]);
    expect(r.map((x) => x.codigo)).toEqual(['Z2', 'Z1', 'C2', 'C5']);
  });

  it('nome usa nomeSku', () => {
    const r = sel([{ codigo: 'A', estoque: 1, un: 30, nome: 'PRETO', fam: 'SHAMPOO X' }]);
    expect(r[0].nome).toBe(nomeSku({ codigo: 'A', titulo: 'PRETO', nomeFamilia: 'SHAMPOO X' }));
  });
});
