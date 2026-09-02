import { describe, expect, it } from 'vitest';
import { agruparAlertasPorProduto } from '../pulse-alertas-grupo';
import type { PulseAlerta } from '@/lib/pulse';

const a = (over: Partial<PulseAlerta>): PulseAlerta => ({
  id: 'x', produto_id: 'p1', tipo: 'preco_caiu', payload: { de: 70, para: 68 },
  lido: false, criado_em: '2026-09-01T10:00:00.000Z', severidade: 'acao',
  pulse_produtos: { titulo: 'Aptamil', codigo_pai: 'A1', catalog_product_id: 'MLB1' }, ...over,
});

describe('agruparAlertasPorProduto (ADR-0133 Errata 4 D-1)', () => {
  it('nove alertas de quatro produtos viram quatro linhas', () => {
    const alertas = ['p1', 'p1', 'p2', 'p2', 'p3', 'p3', 'p4', 'p4', 'p4']
      .map((produto_id, i) => a({ id: `a${i}`, produto_id }));
    expect(agruparAlertasPorProduto(alertas)).toHaveLength(4);
  });

  it('o grupo exibe o alerta MAIS RECENTE e conta o total', () => {
    const g = agruparAlertasPorProduto([
      a({ id: 'velho', criado_em: '2026-09-01T08:00:00.000Z' }),
      a({ id: 'novo', criado_em: '2026-09-01T11:00:00.000Z' }),
    ]);
    expect(g[0].maisRecente.id).toBe('novo');
    expect(g[0].total).toBe(2);
    expect(g[0].demais.map((x) => x.id)).toEqual(['velho']);
    expect(g[0].ids).toEqual(['novo', 'velho']);
  });

  it('preserva a ordem de chegada dos grupos — a lista já vem por criado_em desc', () => {
    const g = agruparAlertasPorProduto([
      a({ id: 'a', produto_id: 'p2', criado_em: '2026-09-01T11:00:00.000Z' }),
      a({ id: 'b', produto_id: 'p1', criado_em: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(g.map((x) => x.produtoId)).toEqual(['p2', 'p1']);
  });

  it('alerta sem produto_id vira grupo de um, nunca um balde comum', () => {
    const g = agruparAlertasPorProduto([
      a({ id: 'sem1', produto_id: null }),
      a({ id: 'sem2', produto_id: null }),
    ]);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.total === 1)).toBe(true);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(agruparAlertasPorProduto([])).toEqual([]);
  });
});
