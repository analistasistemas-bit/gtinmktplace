import { describe, it, expect } from 'vitest';
import { montarDetalheVendas } from '@/lib/detalhe-vendas';
import type { MetricasVendas } from '@/lib/metricas';
import type { PublicadoItem } from '@/lib/publicados';

const publicados = [
  { mlItemId: 'MLB1', titulo: 'App Item', codigoPai: '00445975', gtin: '7891521360659' },
] as unknown as PublicadoItem[];

const metricas: MetricasVendas = {
  porItem: { MLB1: { unidades: 2, valor: 90 } },
  totais: { faturamento: 120, unidades: 5, pedidos: 3 },
  externos: [{ id: 'MLBX', titulo: 'Externo', unidades: 3, valor: 30 }],
};

describe('montarDetalheVendas', () => {
  it('compõe app + externo somando ao total, com % e títulos', () => {
    const r = montarDetalheVendas(metricas, publicados);
    expect(r.total).toBe(120);
    expect(r.pedidos).toBe(3);

    expect(r.app.valor).toBe(90);
    expect(r.app.unidades).toBe(2);
    expect(r.app.linhas[0].titulo).toBe('App Item');
    expect(r.app.linhas[0].codigo).toBe('00445975');
    expect(r.app.linhas[0].ean).toBe('7891521360659');
    expect(r.app.linhas[0].pctTotal).toBeCloseTo(75);

    expect(r.externo.valor).toBe(30);
    expect(r.externo.linhas[0].titulo).toBe('Externo');
    // Itens fora do PubliAI não têm código/EAN no catálogo.
    expect(r.externo.linhas[0].codigo).toBeNull();
    expect(r.externo.linhas[0].ean).toBeNull();

    expect(r.app.valor + r.externo.valor).toBe(r.total);
  });

  it('usa o id como título quando o anúncio do app não está em publicados', () => {
    const r = montarDetalheVendas(metricas, [] as PublicadoItem[]);
    expect(r.app.linhas[0].titulo).toBe('MLB1');
  });
});
