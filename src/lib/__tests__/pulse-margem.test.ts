import { describe, it, expect } from 'vitest';
import { estadoAtualOfertas, menorPrecoPorDia, vendasEstimadasVendedor, margemEstimada } from '../pulse-margem';
import type { PulseOferta, PulseVendedor } from '../pulse';

const oferta = (over: Partial<PulseOferta>): PulseOferta => ({
  item_id: 'MLB1', seller_id: 111, preco: 100, tier: 'gold_special',
  frete_gratis: true, loja_oficial: false, ativo: true, dia: '2026-08-10', ...over,
});

const vendedor = (over: Partial<PulseVendedor>): PulseVendedor => ({
  seller_id: 111, nickname: 'LOJA', power_seller: 'platinum', nivel: '5_green',
  transactions_total: 100, dia: '2026-08-10', ...over,
});

describe('estadoAtualOfertas', () => {
  it('mantém só a última linha por item (por dia), ordenada por preço', () => {
    const ofertas = [
      oferta({ item_id: 'A', dia: '2026-08-10', preco: 100 }),
      oferta({ item_id: 'A', dia: '2026-08-12', preco: 90 }), // mais recente vence
      oferta({ item_id: 'B', dia: '2026-08-11', preco: 50 }),
    ];
    expect(estadoAtualOfertas(ofertas)).toEqual([
      oferta({ item_id: 'B', dia: '2026-08-11', preco: 50 }),
      oferta({ item_id: 'A', dia: '2026-08-12', preco: 90 }),
    ]);
  });

  it('descarta item cuja última linha está desativada (oferta saiu do catálogo)', () => {
    const ofertas = [
      oferta({ item_id: 'A', dia: '2026-08-10', preco: 100, ativo: true }),
      oferta({ item_id: 'A', dia: '2026-08-12', preco: 100, ativo: false }),
      oferta({ item_id: 'B', dia: '2026-08-10', preco: 80, ativo: true }),
    ];
    expect(estadoAtualOfertas(ofertas)).toEqual([oferta({ item_id: 'B', dia: '2026-08-10', preco: 80 })]);
  });
});

describe('menorPrecoPorDia', () => {
  it('agrupa o menor preço entre as ofertas ativas de cada dia, em ordem cronológica', () => {
    const ofertas = [
      oferta({ dia: '2026-08-12', preco: 90, item_id: 'A' }),
      oferta({ dia: '2026-08-10', preco: 100, item_id: 'A' }),
      oferta({ dia: '2026-08-10', preco: 80, item_id: 'B' }),
      oferta({ dia: '2026-08-11', preco: 70, item_id: 'C', ativo: false }), // desativada: ignora
    ];
    expect(menorPrecoPorDia(ofertas)).toEqual([
      { dia: '2026-08-10', preco: 80 },
      { dia: '2026-08-12', preco: 90 },
    ]);
  });
});

describe('vendasEstimadasVendedor', () => {
  it('retorna null com menos de 2 pontos', () => {
    expect(vendasEstimadasVendedor([])).toBeNull();
    expect(vendasEstimadasVendedor([vendedor({})])).toBeNull();
  });

  it('calcula o delta entre a 1ª e a última leitura (ordena por dia)', () => {
    const hist = [
      vendedor({ dia: '2026-08-14', transactions_total: 130 }),
      vendedor({ dia: '2026-08-10', transactions_total: 100 }),
    ];
    expect(vendasEstimadasVendedor(hist)).toBe(30);
  });

  it('retorna null se algum ponto não tiver transactions_total', () => {
    const hist = [
      vendedor({ dia: '2026-08-10', transactions_total: null }),
      vendedor({ dia: '2026-08-14', transactions_total: 130 }),
    ];
    expect(vendasEstimadasVendedor(hist)).toBeNull();
  });
});

describe('margemEstimada — regra LOUD: qualquer insumo ausente → null', () => {
  const base = { preco: 100, custoProduto: 40, ptwCustos: { comissao: 10, frete: 8 }, aliquotaPct: 8 };

  it('calcula margem completa quando todos os insumos existem', () => {
    // líquido = 100 − 10 − 8 − (100*8/100) − 40 = 34
    expect(margemEstimada(base)).toEqual({ liquido: 34, margemPct: 34 });
  });

  it('retorna null sem custo do produto', () => {
    expect(margemEstimada({ ...base, custoProduto: null })).toBeNull();
  });

  it('retorna null sem comissão do price-to-win', () => {
    expect(margemEstimada({ ...base, ptwCustos: { comissao: null, frete: 8 } })).toBeNull();
  });

  it('retorna null sem frete do price-to-win', () => {
    expect(margemEstimada({ ...base, ptwCustos: { comissao: 10, frete: null } })).toBeNull();
  });

  it('retorna null sem price-to-win nenhum', () => {
    expect(margemEstimada({ ...base, ptwCustos: null })).toBeNull();
  });

  it('retorna null sem alíquota de imposto', () => {
    expect(margemEstimada({ ...base, aliquotaPct: null })).toBeNull();
  });
});
