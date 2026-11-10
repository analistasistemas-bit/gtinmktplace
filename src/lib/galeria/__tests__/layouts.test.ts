import { describe, expect, it } from 'vitest';
import { razaoContraste, corDeAcento } from '../contraste';
import { layoutMissao, recortesDetalhe, type Caixa } from '../layouts';
import { planejarCorte } from '../../../../supabase/functions/_shared/galeria/corte';
import { areaCena, layoutCena } from '../../../../supabase/functions/_shared/galeria/layout-area';
import { montarPromptCena } from '../../../../supabase/functions/_shared/galeria/prompt';

const cheio = {
  headline: 'Cabe em duas linhas', subheadline: 'Subtítulo',
  beneficios: ['a', 'b', 'c', 'd'], specs: [{ rotulo: 'Marca', valor: 'X' }, { rotulo: 'L', valor: '1' }, { rotulo: 'C', valor: '2' }, { rotulo: 'Cor', valor: 'Z' }, { rotulo: 'Extra', valor: 'W' }],
  etapas: ['1', '2', '3', '4', '5'], legendas: ['x', 'y', 'z'],
};

describe('contraste', () => {
  it('branco × #1b1f24 passa de 16', () => { expect(razaoContraste('#ffffff', '#1b1f24')).toBeGreaterThan(16); });
  it('acento claro demais para a placa branca cai para o texto escuro', () => {
    expect(corDeAcento('#139aa0')).toBe('#1b1f24');
  });
  it('acento que passa de 4,5 sobre branco é mantido; o resultado sempre passa', () => {
    expect(corDeAcento('#1f2a52')).toBe('#1f2a52');
    for (const c of ['#c94f7c', '#1f2a52', '#139aa0']) expect(razaoContraste(corDeAcento(c), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('corte (o front usa o módulo da edge)', () => {
  it('864×1152 corta ≈3,7%', () => {
    const p = planejarCorte(864, 1152, false);
    expect(p.modo).toBe('corte');
    expect(p.perda).toBeCloseTo(0.037, 3);
  });
  it('1024×1024: bloqueado; capa: preenchimento', () => {
    expect(planejarCorte(1024, 1024, false).modo).toBe('bloqueado');
    expect(planejarCorte(1024, 1024, true).modo).toBe('preenchimento');
  });
});

describe('layoutMissao', () => {
  for (const m of [2, 3, 4, 5, 6, 7]) {
    it(`missão ${m}: toda caixa fica na área segura e com fonte ≥60`, () => {
      const caixas = layoutMissao(m, cheio);
      expect(caixas.length).toBeGreaterThan(0);
      for (const c of caixas) {
        expect(c.fontePx).toBeGreaterThanOrEqual(60);
        expect(c.x).toBeGreaterThanOrEqual(72);
        expect(c.x + c.w).toBeLessThanOrEqual(1128);
        expect(c.y).toBeGreaterThanOrEqual(184.8);
        expect(c.y + c.h).toBeLessThanOrEqual(1355.2);
      }
    });
  }

  it('tetos: 3 benefícios, 4 pares, 4 etapas; sem sobreposição na coluna', () => {
    expect(layoutMissao(4, cheio)).toHaveLength(1 + 3);
    expect(layoutMissao(5, cheio)).toHaveLength(1 + 4 * 2);
    expect(layoutMissao(6, cheio)).toHaveLength(1 + 4);
    for (const m of [4, 6]) {
      const col = layoutMissao(m, cheio).sort((a, b) => a.y - b.y);
      col.slice(1).forEach((c, i) => expect(c.y).toBeGreaterThanOrEqual(col[i].y + col[i].h));
    }
  });

  it('missão 1 sem caixa; título entre 7% e 8,5% da largura, em até 2 linhas', () => {
    expect(layoutMissao(1, cheio)).toEqual([]);
    const h = layoutMissao(2, cheio)[0];
    expect(h.fontePx).toBeGreaterThanOrEqual(84);
    expect(h.fontePx).toBeLessThanOrEqual(102);
    expect(h.linhasMax).toBe(2);
  });

  it('cada caixa das missões com cena cabe numa área que o prompt reserva', () => {
    const dentro = (m: number, c: Caixa) =>
      areaCena(m).some((r) => c.x >= r.x0 && c.x + c.w <= r.x1 && c.y >= r.y0 && c.y + c.h <= r.y1);
    for (const m of [2, 3, 4, 5, 6]) for (const c of layoutMissao(m, cheio)) expect(dentro(m, c)).toBe(true);
  });

  it('o prompt das missões com texto cita a área reservada; capa e recorte não têm área', () => {
    const r = { categoria: 'c', contrato: 'k', missoes: [] };
    const mis = (n: number) => ({ missao: n, ativa: true, cena: 'x', fatosUsados: [] }) as never;
    for (const n of [2, 3, 4, 5, 6]) {
      expect(montarPromptCena(mis(n), r, false, 'Preto', layoutCena(n))).toContain(layoutCena(n)!.areaTexto);
    }
    expect(layoutCena(1)).toBeNull();
    expect(layoutCena(7)).toBeNull();
  });
});

describe('recortesDetalhe', () => {
  it('dois recortes quadrados, inteiros e dentro da referência', () => {
    for (const [w, h] of [[1000, 1000], [864, 1152], [600, 300]]) {
      const r = recortesDetalhe(w, h);
      expect(r).toHaveLength(2);
      for (const c of r) {
        expect(c.w).toBe(c.h);
        expect(Number.isInteger(c.x) && Number.isInteger(c.y) && Number.isInteger(c.w)).toBe(true);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(w);
        expect(c.y + c.h).toBeLessThanOrEqual(h);
      }
    }
  });
});
