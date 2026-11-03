// Relatório mensal do cliente (ADR-0193, Fatia 1): leituras do mês M e M−1 e da série, todas com
// `org_id` explícito (a edge roda com service_role, que ignora RLS). O cálculo fica no módulo puro.
// Vendas e contexto de custo são o núcleo: falha lança. Devoluções, Ads, visitas e catálogo de
// família são seções: falha vira `null` + aviso `error` (desconhecido nunca vira zero).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { carregarContexto, lerPaginas, lerVendasJanela, readMonthSeries, type MetricsDb } from './metrics-repository.ts';
import {
  calcularMes, diario, estornosNoPeriodo, estornosSemValor, kpisAds, kpisDoPeriodo, serieMensal, topFamilias, trafego,
  type AdsDiaRow, type ComponentesSerie, type EstornoDevolucao, type VisitaDiaRow,
} from './monthly-report.ts';
import type { BillingStatement, MetricsWarning, Month, MonthlyReport } from './types.ts';
import { lerCatalogoEstoque } from '../notificacoes/gerencial/catalogo-io.ts';
import { diaBrt } from '../notificacoes/gerencial/janelas.ts';

type Consulta = ReturnType<MetricsDb['from']>;
const LOTE = 200;
const MESES_SERIE = 12;

function addMonths(month: Month, delta: number): Month {
  const [a, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const inicio = (month: Month) => `${month}-01T00:00:00-03:00`;

async function paginas(build: () => unknown, rotulo: string): Promise<Record<string, unknown>[]> {
  const { rows, error } = await lerPaginas(build as () => Consulta);
  if (error) throw new Error(`${rotulo}: ${error.message}`);
  return rows;
}

async function lerDevolucoes(admin: SupabaseClient, orgId: string, desde: string, ate: string): Promise<EstornoDevolucao[]> {
  const linhas = await paginas(() => admin.from('ml_devolucoes')
    .select('id, order_id, type, return_status_money, aberto_em, fechado_em')
    .eq('org_id', orgId).eq('type', 'returns').eq('return_status_money', 'refunded')
    .or(`and(fechado_em.gte.${desde},fechado_em.lt.${ate}),and(fechado_em.is.null,aberto_em.gte.${desde},aberto_em.lt.${ate})`)
    .order('id', { ascending: true }), 'devoluções');
  // Valor = `ml_vendas.estorno` do pedido (como src/lib/devolucoes.ts), que pode ser de mês anterior.
  const ids = [...new Set(linhas.map((r) => r.order_id).filter((id) => id != null))];
  const estorno = new Map<unknown, number>();
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await admin.from('ml_vendas').select('order_id, estorno').eq('org_id', orgId).in('order_id', ids.slice(i, i + LOTE));
    if (error) throw new Error(`estorno das devoluções: ${error.message}`);
    for (const v of data ?? []) estorno.set(v.order_id, Number(v.estorno ?? 0));
  }
  return linhas.map((r) => ({
    order_id: (r.order_id as number | null) ?? null, type: (r.type as string | null) ?? null,
    return_status_money: (r.return_status_money as string | null) ?? null,
    aberto_em: (r.aberto_em as string | null) ?? null, fechado_em: (r.fechado_em as string | null) ?? null,
    valor_estornado: estorno.get(r.order_id) ?? 0,
    sem_valor: r.order_id == null || !estorno.has(r.order_id),
  }));
}

async function lerUm<T>(build: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, rotulo: string): Promise<T | null> {
  const { data, error } = await build();
  if (error) throw new Error(`${rotulo}: ${error.message}`);
  return (data as T | null) ?? null;
}

export async function montarRelatorioMensal(admin: SupabaseClient, orgId: string, month: Month, agora: Date): Promise<MonthlyReport> {
  const db = admin as unknown as MetricsDb;
  const prev = addMonths(month, -1);
  const corrente = month === diaBrt(agora).slice(0, 7);
  const jM = { desde: inicio(month), ate: corrente ? agora.toISOString() : inicio(addMonths(month, 1)) };
  // Mês corrente compara com o mesmo tempo decorrido do anterior (como readOrgMetrics).
  const jP = {
    desde: inicio(prev),
    ate: corrente
      ? new Date(Math.min(Date.parse(inicio(prev)) + (agora.getTime() - Date.parse(jM.desde)), Date.parse(inicio(month)))).toISOString()
      : inicio(month),
  };
  const desdeSerie = addMonths(month, -(MESES_SERIE - 1));
  const warnings: MetricsWarning[] = [];
  const secao = async <T>(p: Promise<T>, code: string, message: string): Promise<T | null> => {
    try { return await p; } catch (e) {
      console.error('monthly_report_secao', code, e);
      warnings.push({ code, severity: 'error', message: `${message}: ${e instanceof Error ? e.message : String(e)}` });
      return null;
    }
  };

  const [org, termos, stmt, vendas, vendasPrev, ctx, devs, ads, sync, visitas] = await Promise.all([
    lerUm<{ id: string; nome: string; slug: string }>(() => admin.from('organizations').select('id, nome, slug').eq('id', orgId).maybeSingle(), 'organização'),
    paginas(() => admin.from('platform_commercial_terms').select('id, modality, starts_on, version').eq('org_id', orgId)
      .order('starts_on', { ascending: false }).order('version', { ascending: false }), 'condições comerciais'),
    lerUm<{ id: string; snapshot: BillingStatement; closed_at: string; closed_by: string }>(() => admin.from('platform_billing_statements')
      .select('id, snapshot, closed_at, closed_by').eq('org_id', orgId).eq('month', `${month}-01`).maybeSingle(), 'demonstrativo'),
    lerVendasJanela(db, orgId, jM),
    lerVendasJanela(db, orgId, jP),
    carregarContexto(db, orgId, inicio(prev)),
    secao(lerDevolucoes(admin, orgId, jP.desde, jM.ate), 'refunds_read_failed', 'Falha ao ler as devoluções'),
    secao(paginas(() => admin.from('ml_ads_conta_dia').select('dia, cost, clicks, prints, direct_amount, total_amount, coletado_em')
      .eq('org_id', orgId).gte('dia', `${desdeSerie}-01`).lt('dia', `${addMonths(month, 1)}-01`).order('dia', { ascending: true }), 'Ads')
      .then((rows) => rows as unknown as AdsDiaRow[]), 'ads_read_failed', 'Falha ao ler o Ads da conta'),
    secao(lerUm<{ conta_cobertura_desde: string | null }>(() => admin.from('ml_ads_sync').select('conta_cobertura_desde').eq('org_id', orgId).maybeSingle(), 'sync de Ads'),
      'ads_read_failed', 'Falha ao ler a sincronização do Ads'),
    secao(paginas(() => admin.from('ml_item_visitas_dia').select('ml_item_id, dia, visitas, estado')
      .eq('org_id', orgId).eq('estado', 'ok').gte('dia', `${month}-01`).lt('dia', `${addMonths(month, 1)}-01`)
      .order('ml_item_id', { ascending: true }).order('dia', { ascending: true }), 'visitas')
      .then((rows) => rows as unknown as VisitaDiaRow[]), 'traffic_read_failed', 'Falha ao ler as visitas'),
  ]);
  if (!org) throw new Error('organization not found');
  const semValor = devs ? estornosSemValor(devs, jM) : 0;
  if (semValor > 0) {
    warnings.push({ code: 'refunds_unmatched', severity: 'warning',
      message: `${semValor} ${semValor === 1 ? 'devolução concluída sem pedido vinculado' : 'devoluções concluídas sem pedido vinculado'}: valor fora dos estornos` });
  }
  if (!ctx.configOk) warnings.push({ code: 'tax_config_unconfirmed', severity: 'warning', message: 'Configuração tributária não confirmada' });

  const hoje = diaBrt(agora);
  const atual = calcularMes(vendas, ctx, agora);
  const anterior = calcularMes(vendasPrev, ctx, agora);
  // Ads com falha de leitura de uma das duas tabelas = indisponível (o aviso já foi registrado).
  const adsOk = ads != null && !warnings.some((w) => w.code === 'ads_read_failed');
  const adsDoMes = (m: Month, gross: number) => (adsOk ? kpisAds(ads!, sync, m, hoje, gross) : null);
  const adsM = adsDoMes(month, atual.componentes.gross_cents);

  const codigos = [...new Set(atual.itens.map((it) => it.codigo?.trim()).filter((c): c is string => !!c))];
  const catalogo = await secao(lerCatalogoEstoque(admin, orgId, codigos), 'family_catalog_read_failed', 'Falha ao ler as famílias');

  const conhecidos = new Map<Month, ComponentesSerie>([[month, atual.componentes]]);
  if (!corrente) conhecidos.set(prev, anterior.componentes);
  const pontos = await readMonthSeries(db, orgId, month, agora, MESES_SERIE, conhecidos);
  const adsPorMes = new Map(pontos.map((p) => [p.month, p.componentes ? adsDoMes(p.month, p.componentes.gross_cents) : null]));

  const termo = (termos as Array<{ modality: number; starts_on: string }>).find((t) => t.starts_on <= `${month}-01`);
  const modality = (stmt?.snapshot?.terms?.modality ?? termo?.modality ?? null) as 1 | 2 | null;
  return {
    org: { id: org.id, nome: org.nome, slug: org.slug, modality },
    month, previous_month: prev, generated_at: agora.toISOString(),
    statement: stmt
      ? { status: 'closed', id: stmt.id, closed_at: stmt.closed_at, snapshot: { ...stmt.snapshot, id: stmt.id, closed_at: stmt.closed_at, closed_by: stmt.closed_by } }
      : { status: 'open' },
    summary: {
      current: kpisDoPeriodo(atual.componentes, devs ? estornosNoPeriodo(devs, jM) : null, adsM),
      previous: anterior.componentes.orders > 0
        ? kpisDoPeriodo(anterior.componentes, devs ? estornosNoPeriodo(devs, jP) : null, corrente ? null : adsDoMes(prev, anterior.componentes.gross_cents))
        : null,
    },
    daily: diario(month, vendas, atual.itens, vendasPrev, adsM?.coverage === 'complete' ? ads!.filter((d) => d.dia.startsWith(`${month}-`)) : null, agora),
    series: serieMensal(pontos, adsPorMes),
    top_families: catalogo ? topFamilias(atual.itens, catalogo) : null,
    ads: adsM,
    traffic: visitas ? trafego(visitas, vendas, month) : null,
    warnings,
  };
}
