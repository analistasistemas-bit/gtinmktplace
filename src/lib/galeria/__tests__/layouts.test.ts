import { describe, expect, it } from 'vitest';
import { razaoContraste, corDeAcento } from '../contraste';
import { layoutMissao, linhasNecessarias, lupasMissao, motivosDeTexto, type Caixa } from '../../../../supabase/functions/_shared/galeria/layouts';
import { CAMPOS_DA_MISSAO, CAPACIDADE } from '../../../../supabase/functions/_shared/galeria/regras';
import * as compor from '../compor';
import { planejarCorte } from '../../../../supabase/functions/_shared/galeria/corte';
import { areaCena, layoutCena } from '../../../../supabase/functions/_shared/galeria/layout-area';

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

  // O prompt citar `areaTexto` é testado em `_shared/galeria/__tests__/cena.test.ts` (prompt.ts puxa a edge para o tsc do app).
  it('capa e recorte não têm área reservada', () => {
    expect(layoutCena(1)).toBeNull();
    expect(layoutCena(7)).toBeNull();
  });
});

// Piores casos dos tetos de regras.ts/roteiro.ts (5 palavras longas) medidos com a estimativa conservadora de largura.
const HEADLINE = 'Aplicação rápida sem ferramenta extra';
const LEGENDA = 'Acabamento firme que não desfia';
const SUB = 'Ideal para vestidos juninos e roupas infantis';
const cabe = (c: Caixa, texto: string) => expect(linhasNecessarias(texto, c.fontePx, c.w)).toBeLessThanOrEqual(c.linhasMax);

describe('textos máximos cabem nas caixas (revisão T11)', () => {
  it('a estimativa de largura é conservadora e quebra por palavra', () => {
    expect(linhasNecessarias('a', 60, 1056)).toBe(1);
    expect(linhasNecessarias(HEADLINE, 84, 400)).toBeGreaterThan(2);
    expect(linhasNecessarias(HEADLINE, 84, 1056)).toBe(2);
  });

  it('headline de 5 palavras cabe em até 2 linhas nas missões 2 a 7 (inclusive 4 e 6)', () => {
    for (const m of [2, 3, 4, 5, 6, 7]) cabe(layoutMissao(m, cheio)[0], HEADLINE);
  });

  it('subheadline cabe na missão 2/3 e o chip da 3 cabe com a legenda de 5 palavras', () => {
    const c3 = layoutMissao(3, cheio);
    cabe(c3[1], SUB);
    cabe(c3[2], LEGENDA);
  });

  it('etapas de 7 palavras (piores casos) cabem em 2 linhas a ≥60 px, 4 etapas na área reservada', () => {
    const cx = layoutMissao(6, cheio);
    expect(cx).toHaveLength(1 + 4);
    for (const c of cx.slice(1)) {
      expect(c.linhasMax).toBe(2);
      expect(c.h / 2).toBeGreaterThanOrEqual(1.2 * c.fontePx);
      cabe(c, 'Desenrole a fita e cole na borda');
      cabe(c, 'Pressione firmemente cada trecho antes de continuar');
    }
  });

  it('legendas da missão 7 cabem', () => {
    for (const c of layoutMissao(7, cheio).slice(1)) cabe(c, LEGENDA);
  });

  it('entrelinha do título ≥1,2: duas linhas não se cruzam', () => {
    for (const m of [2, 3, 4, 5, 6, 7]) {
      const t = layoutMissao(m, cheio)[0];
      expect(t.h / t.linhasMax).toBeGreaterThanOrEqual(1.2 * t.fontePx);
    }
  });

  it('missão 5: título de 2 linhas + 4 pares ficam dentro do retângulo reservado e sem sobreposição', () => {
    const cx = layoutMissao(5, cheio);
    const r = areaCena(5)[0];
    for (const c of cx) { expect(c.y).toBeGreaterThanOrEqual(r.y0); expect(c.y + c.h).toBeLessThanOrEqual(r.y1); }
    expect(cx[0].linhasMax).toBe(2);
    const ys = [...new Set(cx.map((c) => c.y))].sort((p, q) => p - q);
    ys.slice(1).forEach((y, i) => {
      const fim = Math.max(...cx.filter((c) => c.y === ys[i]).map((c) => c.y + c.h));
      expect(y).toBeGreaterThanOrEqual(fim);
    });
  });
});

describe('lupas (recortes da referência)', () => {
  const sobrepoe = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const ret = (l: { x: number; y: number; lado: number }) => ({ x: l.x, y: l.y, w: l.lado, h: l.lado });

  it('missão 3: uma lupa dentro de uma área que o prompt reserva, na área segura e longe do texto', () => {
    const [l, ...resto] = lupasMissao(3);
    expect(resto).toEqual([]);
    expect(areaCena(3).some((r) => l.x >= r.x0 && l.x + l.lado <= r.x1 && l.y >= r.y0 && l.y + l.lado <= r.y1)).toBe(true);
    expect(l.x).toBeGreaterThanOrEqual(72); expect(l.y + l.lado).toBeLessThanOrEqual(1355.2);
    for (const c of layoutMissao(3, cheio)) expect(sobrepoe(ret(l), c)).toBe(false);
    expect(layoutCena(3)!.areaTexto).toMatch(/bottom-left/);
  });

  it('missão 7: duas lupas na área segura, sem sobrepor uma à outra nem ao texto', () => {
    const ls = lupasMissao(7);
    expect(ls).toHaveLength(2);
    expect(sobrepoe(ret(ls[0]), ret(ls[1]))).toBe(false);
    for (const l of ls) {
      expect(l.x).toBeGreaterThanOrEqual(72); expect(l.x + l.lado).toBeLessThanOrEqual(1128);
      expect(l.y).toBeGreaterThanOrEqual(184.8); expect(l.y + l.lado).toBeLessThanOrEqual(1355.2);
      for (const c of layoutMissao(7, cheio)) expect(sobrepoe(ret(l), c)).toBe(false);
    }
  });

  it('demais missões sem lupa', () => {
    for (const m of [1, 2, 4, 5, 6]) expect(lupasMissao(m)).toEqual([]);
  });
});

// Fase A: a regra de texto × layout é uma só, no módulo compartilhado (o roteiro na edge poda com ela).
describe('paridade servidor × front (Fase A)', () => {
  it('compor usa a mesma motivosDeTexto do módulo compartilhado', () => {
    expect(compor.motivosDeTexto).toBe(motivosDeTexto);
  });

  it('CAPACIDADE = número de caixas de cada lista no layout', () => {
    const muitos = { subheadline: 'x', beneficios: Array(9).fill('x'), specs: Array(9).fill({ rotulo: 'x', valor: 'x' }), etapas: Array(9).fill('x'), legendas: Array(9).fill('x') };
    for (const [m, cap] of Object.entries(CAPACIDADE)) {
      const [campo, n] = Object.entries(cap)[0];
      const porItem = campo === 'specs' ? 2 : 1;
      const semLista = layoutMissao(Number(m), { ...muitos, [campo]: [] }).length;
      expect(layoutMissao(Number(m), muitos).length - semLista, `missão ${m}`).toBe(n! * porItem);
    }
  });

  it('campo fora de CAMPOS_DA_MISSAO recusa; campo da tabela não', () => {
    for (const [m, campos] of Object.entries(CAMPOS_DA_MISSAO)) {
      for (const c of ['subheadline', 'beneficios', 'etapas', 'legendas'] as const) {
        const motivos = motivosDeTexto(Number(m), { headline: 'Fita', [c]: c === 'subheadline' ? 'Fita' : ['Fita'] }, false);
        expect(motivos.some((x) => /não aparece no layout/.test(x)), `missão ${m} ${c}`).toBe(!campos.includes(c));
      }
    }
  });
});
