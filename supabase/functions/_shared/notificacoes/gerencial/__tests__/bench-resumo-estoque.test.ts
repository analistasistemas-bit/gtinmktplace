import { describe, expect, it } from 'vitest';
import { resultadoPorItem } from '../resultado.ts';
import { selecionarEstoqueAcabando, type CatalogoEstoque } from '../estoque-acabando.ts';
import { montarResumoDiario, type DadosResumo } from '../mensagens.ts';
import { montarMapasCusto } from '../../../platform-admin/sales-costs.ts';
import type { ContextoCalculo } from '../../../platform-admin/metrics-repository.ts';
import type { Venda, VendaItem } from '../../../platform-admin/sales-types.ts';

// Trava de CPU (ADR-0190 fase 1): 5.000 vendas × 2–3 itens, 300 SKUs, 30 dias ≤ 250 ms de CPU.
const SKUS = 300;
const VENDAS = 5000;
const FIM = '2026-10-25T03:00:00.000Z';
const fimMs = Date.parse(FIM);

const catRow = (i: number) => ({
  custo: 10 + (i % 20), peso_gramas: 100 + (i % 10) * 50, ml_variation_id: String(i), gtin: null, codigo: null,
  atualizado_em: '2026-01-01', familias: { ml_item_id: `MLB${i}`, origem: i % 2 ? 'nacional' : 'importado' },
});

function sintetico() {
  const ctx: ContextoCalculo = {
    maps: montarMapasCusto(Array.from({ length: SKUS }, (_, i) => catRow(i))),
    rates: { nacional: 8, importado: 16, ufEmpresa: 'CE', internaPct: 8 }, custosOk: true, configOk: true,
  };
  const vendas: Venda[] = Array.from({ length: VENDAS }, (_, n) => {
    const nItens = 2 + (n % 2);
    const itens: VendaItem[] = Array.from({ length: nItens }, (_, k) => {
      const s = (n * 7 + k * 31) % SKUS;
      return {
        id: `i${n}-${k}`, ml_item_id: `MLB${s}`, variation_id: s, titulo: `Produto ${s}`, codigo: `SKU${s}`, cor: null, ean: null,
        quantity: 1 + (n % 3), unit_price: 50 + (s % 40), sale_fee: 5, is_publiai: true, custo_congelado: null,
      };
    });
    const total = itens.reduce((t, i) => t + i.unit_price * i.quantity, 0);
    return {
      id: `v${n}`, order_id: n + 1, pack_id: n % 5 === 0 ? 1_000_000 + Math.floor(n / 5) : null, status: 'paid', status_detail: null,
      date_closed: new Date(fimMs - ((n * 311) % (30 * 24 * 60)) * 60_000 - 60_000).toISOString(), date_created: null,
      comprador_nick: null, comprador_nome: null, comprador_id: null, uf: 'SP', cidade: null, total_amount: total, paid_amount: total,
      liquido: total * 0.8, sale_fee_total: total * 0.1, frete_vendedor: 10, estorno: null, money_release_date: null, sacado_em: null,
      sacado_por: null, atualizado_em: FIM, currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
      shipping_logistic: null, tracking_number: null, is_publiai: true, tem_devolucao: false, itens,
    };
  });
  const catalogo = new Map<string, CatalogoEstoque>(Array.from({ length: SKUS }, (_, i) => [`SKU${i}`, {
    codigo: `SKU${i}`, estoque: i % 10 === 0 ? 0 : (i * 13) % 150, ehKit: false, nome: `Produto ${i}`, nomeFamilia: null,
  }]));
  return { ctx, vendas, catalogo };
}

describe('CPU do cálculo puro do resumo', () => {
  it('5.000 vendas sintéticas: melhor de 3 amostras ≤ 250 ms de CPU', () => {
    const { ctx, vendas, catalogo } = sintetico();
    const dataPorOrder = new Map(vendas.map((v) => [v.order_id, v.date_closed as string]));
    const rodar = () => {
      const cpu0 = process.cpuUsage();
      const itens = resultadoPorItem(vendas, ctx);
      const estoque = selecionarEstoqueAcabando(itens, dataPorOrder, catalogo, FIM);
      const texto = montarResumoDiario({
        dia: '2026-10-24', ontem: { faturamento: 1, pedidos: 1, ticket: 1 },
        lucroOntem: { lucro: 1, motivo: null, pctVendaComLucro: 1, vendaSemCusto: 0, vendaSemImposto: 0, vendaCustoEstimado: 0, pedidosFreteNaoLido: 0, markup: 0.3 },
        mes: { faturamento: 1, pedidos: 1, ticket: 1 }, anterior: { faturamento: 1, pedidos: 1, ticket: 1 },
        rotuloMes: 'Outubro', rotuloAnterior: '1–24/set', top: [], atencao: { abaixoMinimo: 0, prejuizo: 0, semCusto: 0, prejuizos: [], abaixos: [] },
        estoque, devolucoes: { estornado: 0, prazoProximo: 0 }, promocoes: null, freteSubiu: [],
      } satisfies DadosResumo);
      const c = process.cpuUsage(cpu0);
      expect(itens.length).toBeGreaterThan(10_000);
      expect(texto).toContain('📦 Estoque acabando');
      return (c.user + c.system) / 1000;
    };
    rodar(); // aquecimento (JIT/primeira carga)
    const amostras = [rodar(), rodar(), rodar()];
    const melhor = Math.min(...amostras);
    if (melhor > 250 || process.env.BENCH_LOG) console.log(`CPU resumo (ms) amostras: ${amostras.map((x) => x.toFixed(1)).join(', ')}`);
    expect(melhor).toBeLessThanOrEqual(250);
  });
});
