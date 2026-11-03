// ADR-0193 Fatia 1, tarefa 4: paridade do relatório mensal com a aba Vendas SKU (src/lib/vendas-sku.ts,
// agregada por família) e com o lucro por item calculável do gerencial. Fixtures com alíquota
// confirmada, frete lido e sem item de faturamento zero — os três casos em que o gerencial diverge da
// tela DE PROPÓSITO (ver resultado.ts).
import { describe, expect, it } from 'vitest';
import { componentesDoMes, topFamilias } from '../monthly-report.ts';
import { montarAliquotaResolver, montarCustoResolver, montarMapasCusto, montarPesoResolver } from '../sales-costs.ts';
import type { ContextoCalculo } from '../metrics-repository.ts';
import type { Venda, VendaItem } from '../sales-types.ts';
import { resultadoPorItem } from '../../notificacoes/gerencial/resultado.ts';
import { agruparPorPedido } from '../../../../../src/lib/pedidos-faturamento';
import { agregarPorSku, agruparPorFamilia, calcularKpisSku } from '../../../../../src/lib/vendas-sku';
import type { CatalogoSku } from '../../../../../src/lib/vendas-sku-catalogo';

type Row = Record<string, unknown>;
const item = (patch: Partial<VendaItem> = {}): VendaItem => ({
  id: 'i', ml_item_id: 'MLB1', variation_id: 1, titulo: 'P', codigo: 'A1', cor: null, ean: null,
  quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, custo_congelado: null, ...patch,
});
const venda = (patch: Partial<Venda> = {}): Venda => ({
  id: 'v', org_id: 'org-a', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-10-10T12:00:00-03:00', date_created: null, comprador_nick: null, comprador_nome: null,
  comprador_id: null, uf: 'SP', cidade: null, total_amount: 100, paid_amount: 100, liquido: 80,
  sale_fee_total: 10, frete_vendedor: 10, estorno: null, money_release_date: null, sacado_em: null,
  sacado_por: null, atualizado_em: '2026-10-10T12:00:00-03:00', currency: 'BRL', shipping_id: null,
  shipping_status: null, shipping_substatus: null, shipping_logistic: null, tracking_number: null,
  is_publiai: true, tem_devolucao: false, itens: [item()], ...patch,
});
const catRow = (mlItemId: string, varId: number, custo: number, peso: number, origem = 'nacional'): Row => ({
  custo, peso_gramas: peso, ml_variation_id: String(varId), gtin: null, codigo: null,
  atualizado_em: '2026-01-01', familias: { ml_item_id: mlItemId, origem },
});
const maps = montarMapasCusto([catRow('MLB1', 1, 25, 300), catRow('MLB2', 2, 15, 100), catRow('MLB4', 4, 12, 200, 'importado')]);
const ctx: ContextoCalculo = { maps, rates: { nacional: 8, importado: 16, ufEmpresa: 'CE', internaPct: 8 }, custosOk: true, configOk: true };

const cat = (codigo: string, codigoPai: string): CatalogoSku => ({
  codigo, codigoPai, nomeFamilia: `Fam ${codigoPai}`, nome: null, cor: null, tamanho: null, estoque: 0, fornecedor: null,
  origem: 'nacional', ehKit: false, primeiraVenda: null, ultimaVenda: null, kitMultiplicador: null, kitBaseCodigo: null,
});
const catalogo = new Map([cat('A1', 'PA'), cat('A2', 'PA'), cat('B1', 'PB'), cat('C1', 'PC')].map((c) => [c.codigo, c]));

const vendas: Venda[] = [
  // pack com frete compartilhado (rateio por peso) e duas famílias
  venda({ id: 'p1', order_id: 11, pack_id: 900, shipping_id: 555, total_amount: 60, sale_fee_total: 10, frete_vendedor: 10, liquido: 40,
    itens: [item({ id: 'p1i', unit_price: 60, codigo: 'A1' })] }),
  venda({ id: 'p2', order_id: 12, pack_id: 900, shipping_id: 555, total_amount: 40, sale_fee_total: 9.8, frete_vendedor: 10, liquido: 20.2,
    itens: [item({ id: 'p2i', ml_item_id: 'MLB2', variation_id: 2, unit_price: 40, codigo: 'B1' })] }),
  // multi-item, um sem custo (família B parcial), uf CE
  venda({ id: 'm', order_id: 21, uf: 'CE', total_amount: 100, liquido: 80, itens: [
    item({ id: 'm1', unit_price: 70, codigo: 'A2' }),
    item({ id: 'm2', ml_item_id: 'MLB3', variation_id: 3, unit_price: 30, codigo: 'B1' }),
  ] }),
  // importado, custo congelado, quantidade 3, cupom do vendedor
  venda({ id: 'i', order_id: 31, total_amount: 90, cupom_vendedor: 9, liquido: 60, itens: [
    item({ id: 'ii', ml_item_id: 'MLB4', variation_id: 4, unit_price: 30, quantity: 3, cupom_vendedor: 9, custo_congelado: 11.37, codigo: 'C1' }),
  ] }),
  // reembolsada segue faturável; cancelada fica fora
  venda({ id: 'r', order_id: 41, status: 'refunded', estorno: 100, itens: [item({ id: 'ri', codigo: 'A1' })] }),
  venda({ id: 'c', order_id: 51, status: 'cancelled', liquido: 0, itens: [item({ id: 'ci', codigo: 'C1' })] }),
];

const janela = { desde: '2026-10-01T03:00:00.000Z', ate: '2026-11-01T02:59:59.999Z' };
const pedidos = agruparPorPedido(vendas, montarCustoResolver(maps), montarPesoResolver(maps), undefined, montarAliquotaResolver(maps, ctx.rates));
const linhas = agregarPorSku(pedidos, janela, catalogo, new Set());

describe('paridade com Vendas SKU', () => {
  it('topFamilias = agruparPorFamilia (unidades, faturamento e lucro por família)', () => {
    const tela = agruparPorFamilia(linhas);
    const rel = topFamilias(resultadoPorItem(vendas, ctx), new Map([...catalogo].map(([k, c]) => [k, c])));
    expect(rel.rows).toHaveLength(tela.length);
    for (const row of rel.rows) {
      const f = tela.find((t) => t.codigoPai === row.key)!;
      expect(row.units).toBe(f.acc.unidades);
      expect(row.gross_cents).toBe(Math.round(f.acc.bruto * 100));
      expect(row.profit_cents).toBe(f.m.lucro == null ? null : Math.round(f.m.lucro * 100));
      expect(row.partial).toBe(f.m.fonteCusto === 'parcial' || f.m.fonteCusto === 'sem_custo');
    }
  });

  it('kpisDoPeriodo: lucro = soma da Vendas SKU; faturamento = bruto da tela', () => {
    const c = componentesDoMes(vendas, ctx, new Date('2026-11-02T12:00:00-03:00'));
    const k = calcularKpisSku(linhas);
    expect(c.profit_cents).toBe(Math.round(k.lucro! * 100));
    expect(c.item_gross_cents).toBe(Math.round(k.bruto * 100));
    expect(c.gross_cents).toBe(Math.round(k.bruto * 100));
    expect(c.units).toBe(k.unidades);
  });
});
