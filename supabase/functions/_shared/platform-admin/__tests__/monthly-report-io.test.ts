import { describe, expect, it, vi } from 'vitest';
import { montarRelatorioMensal } from '../monthly-report-io.ts';
import { createPlatformAdminHandler } from '../handler.ts';
import { fakeAdmin } from '../../notificacoes/gerencial/__tests__/fake-postgrest.ts';

type Row = Record<string, unknown>;
const A = '90000000-0000-0000-0000-00000000000a';
const B = '90000000-0000-0000-0000-00000000000b';
const ACTOR = '80000000-0000-0000-0000-000000000001';
const AGORA = new Date('2026-11-02T12:00:00-03:00');

const venda = (org: string, id: string, orderId: number, data: string, preco: number, patch: Row = {}): Row => ({
  id, org_id: org, order_id: orderId, pack_id: null, status: 'paid', date_closed: data, date_created: data, uf: 'SP',
  total_amount: preco, liquido: preco * 0.8, sale_fee_total: preco * 0.1, frete_vendedor: preco * 0.1, cupom_vendedor: 0,
  estorno: null, atualizado_em: data, shipping_id: null, kit_item_id: null,
  itens: [{ org_id: org, venda_id: id, ml_item_id: 'MLB1', variation_id: 1, titulo: 'Produto', codigo: 'SKU1', ean: null,
    quantity: 1, unit_price: preco, cupom_vendedor: 0 }],
  custos: [{ org_id: org, venda_id: id, ml_item_id: 'MLB1', variation_id: 1, custo_unitario: preco * 0.4 }],
  ...patch,
});
const diasOut = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);

/** Duas orgs com dados em TODA tabela lida; B tem valores gritantes para qualquer vazamento aparecer. */
function tabelas(): Record<string, Row[]> {
  const porOrg = (org: string, k: number) => ({
    ml_vendas: [
      venda(org, `${org}-out`, 100 * k + 1, '2026-10-20T12:00:00-03:00', 100 * k),
      venda(org, `${org}-set`, 100 * k + 2, '2026-09-10T12:00:00-03:00', 50 * k),
    ],
    ml_devolucoes: [{ id: `${org}-d`, org_id: org, order_id: 100 * k + 2, type: 'returns', return_status_money: 'refunded',
      aberto_em: '2026-09-28T10:00:00Z', fechado_em: '2026-10-03T10:00:00Z' }],
    ml_ads_conta_dia: diasOut.map((dia) => ({ org_id: org, dia, cost: k, clicks: 10, prints: 100, direct_amount: 2 * k,
      indirect_amount: 0, total_amount: 3 * k, coletado_em: '2026-11-20T12:00:00-03:00' })),
    ml_ads_sync: [{ org_id: org, conta_cobertura_desde: '2026-01-01' }],
    ml_item_visitas_dia: [{ org_id: org, ml_item_id: 'MLB1', dia: '2026-10-20', visitas: 40 * k, estado: 'ok' }],
    variacoes: [{ id: `${org}-v`, org_id: org, codigo: 'SKU1', nome: null, estoque: 1, familia_id: `${org}-f` }],
    familias: [{ id: `${org}-f`, org_id: org, nome_pai: `Família ${k}`, codigo_pai: `PAI-${k}`, kit_multiplicador: null, criado_em: '2026-01-01' }],
    configuracoes: [{ org_id: org, aliquota_nacional_pct: 8, aliquota_importado_pct: 16, uf_empresa: 'CE', aliquota_interna_pct: 8,
      aliquotas_confirmadas_em: '2026-07-21T18:16:19Z' }],
    platform_billing_statements: [{ id: `${org}-s`, org_id: org, month: '2026-10-01', closed_at: '2026-11-01T09:00:00Z', closed_by: ACTOR,
      snapshot: { gross_cents: 10_000 * k, terms: { modality: k === 1 ? 1 : 2 } } }],
    platform_commercial_terms: [{ id: `${org}-t`, org_id: org, modality: k === 1 ? 1 : 2, starts_on: '2026-01-01', version: 1 }],
    organizations: [{ id: org, org_id: org, nome: `Org ${k}`, slug: `org-${k}` }],
  });
  const a = porOrg(A, 1), b = porOrg(B, 99);
  return Object.fromEntries(Object.keys(a).map((t) => [t, [...(a as Record<string, Row[]>)[t], ...(b as Record<string, Row[]>)[t]]]));
}

function adminCom(t: Record<string, Row[]>) {
  const admin = fakeAdmin(t);
  admin.rpcs = [] as Array<{ name: string; args: Row }>;
  admin.rpc = async (name: string, args: Row) => {
    admin.rpcs.push({ name, args });
    if (name === 'platform_org_cost_catalog') {
      return { data: [{ id: 'c', org_id: args.p_org, custo: 1, peso_gramas: 100, ml_variation_id: '1', gtin: null, codigo: 'SKU1',
        atualizado_em: '2026-01-01', ml_item_id: 'MLB1', origem: 'nacional' }], error: null };
    }
    return { data: [], error: null };
  };
  return admin;
}

describe('montarRelatorioMensal (IO)', () => {
  it('monta o mês da org A sem nenhum dado da org B e filtra org_id em toda leitura', async () => {
    const admin = adminCom(tabelas());
    const r = await montarRelatorioMensal(admin, A, '2026-10', AGORA);

    expect(r.org).toEqual({ id: A, nome: 'Org 1', slug: 'org-1', modality: 1 });
    expect(r.statement).toMatchObject({ status: 'closed', id: `${A}-s` });
    expect(r.summary.current).toMatchObject({ gross_cents: 10_000, orders: 1, refunds_cents: 0, ads_cost_cents: 3_100,
      excluded_items: 0, unavailable_reason: null });
    expect(r.summary.previous).toMatchObject({ gross_cents: 5_000 });
    expect(r.ads).toMatchObject({ coverage: 'complete', cost_cents: 3_100, revenue_cents: 9_300 });
    expect(r.traffic).toMatchObject({ visits: 40, listings: 1, orders: 1 });
    expect(r.top_families!.rows).toEqual([expect.objectContaining({ key: 'PAI-1', gross_cents: 10_000, class: 'A' })]);
    expect(r.series.map((p) => p.month)).toEqual(['2026-09', '2026-10']);
    expect(r.daily).toHaveLength(31);
    expect(r.warnings).toEqual([]);

    for (const c of admin.consultas) {
      if (c.tabela === 'organizations') expect(c.filtros).toContain('eq:id');
      // cache lido em lote por lista de orgs (aqui, só [A]) — loadMetricsCache
      else if (c.tabela === 'platform_org_month_metrics') expect(c.filtros).toContain('in:org_id');
      else expect(c.filtros, c.tabela).toContain('eq:org_id');
    }
    expect(admin.consultas.find((c: { tabela: string }) => c.tabela === 'variacoes').filtros).toContain('eq:familias.org_id');
    expect(admin.rpcs.every((c: { args: Row }) => c.args.p_org === A)).toBe(true);
  });

  it('estorno de venda de setembro reembolsado em outubro conta em outubro, pelo estorno do pedido', async () => {
    const t = tabelas();
    (t.ml_vendas.find((v) => v.id === `${A}-set`)!).estorno = 30;
    const r = await montarRelatorioMensal(adminCom(t), A, '2026-10', AGORA);
    expect(r.summary.current.refunds_cents).toBe(3_000);
    expect(r.summary.previous!.refunds_cents).toBe(0);
  });

  it('devolução concluída no mês sem pedido vinculado: avisa (valor desconhecido), sem inventar', async () => {
    const t = tabelas();
    t.ml_devolucoes.push({ id: 'sem-pedido', org_id: A, order_id: null, type: 'returns', return_status_money: 'refunded',
      aberto_em: '2026-10-08T10:00:00Z', fechado_em: '2026-10-15T10:00:00Z' });
    const r = await montarRelatorioMensal(adminCom(t), A, '2026-10', AGORA);
    expect(r.summary.current.refunds_cents).toBe(0);
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'refunds_unmatched', severity: 'warning' })]);
  });

  it('seção que falha vira null + aviso error (Ads), sem zerar', async () => {
    const admin = adminCom(tabelas());
    const from = admin.from;
    admin.from = (tabela: string) => {
      if (tabela !== 'ml_ads_conta_dia') return from(tabela);
      const falha: unknown = new Proxy({}, { get: (_, k) => (k === 'then' ? (res: (v: unknown) => void) => res({ data: null, error: { message: 'boom' } }) : () => falha) });
      return falha;
    };
    const r = await montarRelatorioMensal(admin, A, '2026-10', AGORA);
    expect(r.ads).toBeNull();
    expect(r.summary.current.ads_cost_cents).toBeNull();
    expect(r.summary.current.unavailable_reason).toBe('ads_indisponivel');
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'ads_read_failed', severity: 'error' })]);
  });

  it('org sem Ads e sem demonstrativo: ads null, statement open', async () => {
    const t = tabelas();
    t.ml_ads_conta_dia = t.ml_ads_conta_dia.filter((r) => r.org_id !== A);
    t.ml_ads_sync = t.ml_ads_sync.filter((r) => r.org_id !== A);
    t.platform_billing_statements = t.platform_billing_statements.filter((r) => r.org_id !== A);
    const r = await montarRelatorioMensal(adminCom(t), A, '2026-10', AGORA);
    expect(r.ads).toBeNull();
    expect(r.statement).toEqual({ status: 'open' });
    expect(r.summary.current.unavailable_reason).toBe('ads_indisponivel');
  });
});

describe('montarRelatorioMensal — intervalo de Ads, diário e orçamento (achados Codex 3–5)', () => {
  it('mês corrente: vendas até agora × Ads até ontem → após Ads indisponível e diário null', async () => {
    const t = tabelas();
    t.ml_vendas.push(venda(A, `${A}-nov`, 77, '2026-11-02T09:00:00-03:00', 100));
    t.ml_ads_conta_dia.push({ org_id: A, dia: '2026-11-01', cost: 1, clicks: 1, prints: 1, direct_amount: 0, indirect_amount: 0,
      total_amount: 0, coletado_em: '2026-11-02T11:00:00-03:00' });
    const r = await montarRelatorioMensal(adminCom(t), A, '2026-11', AGORA);
    expect(r.summary.current.gross_cents).toBe(10_000);
    expect(r.summary.current).toMatchObject({ profit_after_ads_cents: null, unavailable_reason: 'ads_cobertura_parcial' });
    expect(r.daily.map((d) => d.profit_after_ads_cents)).toEqual([null, null]);
  });

  it('mês sem venda com Ads completo: resumo e diário sem lucro após Ads', async () => {
    const t = tabelas();
    t.ml_vendas = t.ml_vendas.filter((v) => v.id !== `${A}-out`);
    const r = await montarRelatorioMensal(adminCom(t), A, '2026-10', AGORA);
    expect(r.summary.current.profit_after_ads_cents).toBeNull();
    expect(r.daily.every((d) => d.profit_after_ads_cents === null)).toBe(true);
  });

  it('orçamento compartilhado: M e M−1 consomem antes da série; o resto vira volume', async () => {
    const t = tabelas();
    t.ml_vendas.push(venda(A, `${A}-ago`, 55, '2026-08-10T12:00:00-03:00', 30));
    const r = await montarRelatorioMensal(adminCom(t), A, '2026-10', AGORA, 2);
    expect(r.series.map((p) => [p.month, p.unavailable_reason])).toEqual([['2026-08', 'volume'], ['2026-09', null], ['2026-10', null]]);
    const r2 = await montarRelatorioMensal(adminCom(t), A, '2026-10', AGORA, 3);
    expect(r2.series[0]).toMatchObject({ month: '2026-08', gross_cents: 3_000, unavailable_reason: null });
  });
});

describe('ação monthly_report no handler', () => {
  const ORG = '90000000-0000-0000-0000-000000000001';
  const req = (body: Row) => new Request('http://local/platform-admin', { method: 'POST', body: JSON.stringify(body) });
  const harness = (exists = true) => {
    const repository = { organizationExists: vi.fn().mockResolvedValue(exists), monthlyReport: vi.fn().mockResolvedValue({ ok: true }) };
    return { repository, handler: createPlatformAdminHandler({ authenticate: vi.fn().mockResolvedValue({ userId: ACTOR }), repository }) };
  };

  it('roteia com org e mês; 404 org inexistente; 400 mês inválido ou org_id ausente', async () => {
    const h = harness();
    expect((await h.handler(req({ action: 'monthly_report', org_id: ORG, month: '2026-10' }))).status).toBe(200);
    expect(h.repository.monthlyReport).toHaveBeenCalledWith(ACTOR, ORG, '2026-10');
    expect((await harness(false).handler(req({ action: 'monthly_report', org_id: ORG, month: '2026-10' }))).status).toBe(404);
    expect((await h.handler(req({ action: 'monthly_report', org_id: ORG, month: '2026-13' }))).status).toBe(400);
    expect((await h.handler(req({ action: 'monthly_report', month: '2026-10' }))).status).toBe(400);
  });
});
