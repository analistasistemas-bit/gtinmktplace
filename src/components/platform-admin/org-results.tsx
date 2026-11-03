import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { BarChart3, Receipt, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard, type DeltaTrend } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/lib/formato';
import type { AdsKpis, MonthlyReport, PeriodKpis, TopFamilies } from '@/lib/platform-admin';
import {
  MOTIVO_APOS_ADS, barraCascata, brl, dataHoraBr, linhasCascata, mesPorExtenso, nomeDoMes, pct, variacaoPp, variacaoRel,
  type Variacao,
} from '@/lib/relatorio-mensal-ui';
import { EvolucaoMensal, GraficoDiario } from './org-results-graficos';

const SUFIXO = 'Resultados';
const VISIVEIS_MOBILE = 8;

/** Variação → props do KpiCard. Seta e cor andam juntas no card; em métricas em que subir é ruim
 *  (cancelamentos, estornos) só o texto é mostrado, em tom neutro, para não pintar seta de alta em vermelho. */
function delta(v: Variacao, inverso = false): { delta?: string; deltaTrend: DeltaTrend } {
  if (!v) return { deltaTrend: 'neutral' };
  return { delta: v.texto, deltaTrend: inverso ? 'neutral' : v.tendencia };
}

const razaoX = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);

function Faixa({ tom, children, role }: { tom: 'erro' | 'aviso' | 'info'; children: React.ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={cn(
      'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-4 py-3 text-sm',
      tom === 'erro' && 'border-destructive/30 bg-destructive/5 text-destructive',
      tom === 'aviso' && 'border-warning/40 bg-warning/5',
      tom === 'info' && 'border-border bg-muted/40 text-muted-foreground',
    )}>{children}</div>
  );
}

// ---------------------------------------------------------------------------------------------
// Destaques
// ---------------------------------------------------------------------------------------------
function Destaques({ report }: { report: MonthlyReport }) {
  const k = report.summary.current;
  const p = report.summary.previous;
  const apos = k.profit_after_ads_cents != null;
  const vs = `vs ${nomeDoMes(report.previous_month)}`;
  const semBase = p ? undefined : 'sem mês anterior';
  const lucro = apos ? k.profit_after_ads_cents : k.profit_cents;
  const lucroAnt = apos ? p?.profit_after_ads_cents : p?.profit_cents;
  const motivo = MOTIVO_APOS_ADS[k.unavailable_reason ?? ''] ?? 'dado ausente';
  const rotuloLucro = apos ? 'Lucro após Ads' : k.profit_partial ? 'Lucro antes de Ads (parcial)' : 'Lucro antes de Ads';

  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-2">
        <KpiCard
          variant="brand" icon={Receipt} label="Faturamento da loja" infoKey={`Faturamento da loja::${SUFIXO}`}
          value={brl(k.gross_cents)} valueClassName="text-3xl max-sm:text-2xl"
          {...delta(variacaoRel(k.gross_cents, p?.gross_cents))} hint={p ? vs : semBase}
        />
        <KpiCard
          icon={TrendingUp} label={rotuloLucro} infoKey={`${apos ? 'Lucro após Ads' : 'Lucro antes de Ads'}::${SUFIXO}`}
          value={brl(lucro)} valueClassName={cn('text-3xl max-sm:text-2xl', lucro == null && 'text-muted-foreground')}
          {...delta(variacaoRel(lucro, lucroAnt))} hint={p ? vs : semBase}
        />
      </div>
      {!apos && (
        <Faixa tom="aviso" role="status">
          <span><strong>Lucro após Ads indisponível:</strong> {motivo}. O destaque mostra o lucro antes de Ads{k.profit_partial ? ', só com os itens de lucro calculável' : ''}.</span>
        </Faixa>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Grade de indicadores (estilo "Resumo de desempenho" do ML)
// ---------------------------------------------------------------------------------------------
type Cartao = { chave: string; rotulo: string; valor: string; hint?: string; inverso?: boolean; variacao: Variacao };

function cartoes(report: MonthlyReport): Cartao[] {
  const k = report.summary.current;
  const p = report.summary.previous;
  const t = report.traffic;
  const apos = k.profit_after_ads_cents != null;
  const margem = apos ? k.margin_after_ads : k.margin;
  const markup = apos ? k.markup_after_ads : k.markup;
  const sufixo = apos ? ' após Ads' : ' (antes de Ads)';
  const semLucro = k.profit_cents == null ? 'sem lucro calculável' : undefined;
  const parcial = k.profit_partial ? 'só itens com lucro calculável' : undefined;
  return [
    { chave: 'Pedidos', rotulo: 'Pedidos', valor: fmtInt(k.orders), variacao: variacaoRel(k.orders, p?.orders) },
    { chave: 'Unidades', rotulo: 'Unidades', valor: fmtInt(k.units), variacao: variacaoRel(k.units, p?.units) },
    { chave: 'Ticket médio', rotulo: 'Ticket médio', valor: brl(k.ticket_cents), variacao: variacaoRel(k.ticket_cents, p?.ticket_cents) },
    {
      chave: 'Preço médio por unidade', rotulo: 'Preço médio por unidade', valor: brl(k.unit_price_cents),
      hint: k.unit_price_cents == null ? 'sem unidades vendidas' : undefined, variacao: variacaoRel(k.unit_price_cents, p?.unit_price_cents),
    },
    {
      chave: 'Margem s/ venda', rotulo: `Margem s/ venda${sufixo}`, valor: pct(margem), hint: margem == null ? semLucro ?? MOTIVO_APOS_ADS[k.unavailable_reason ?? ''] : parcial,
      variacao: variacaoPp(margem, apos ? p?.margin_after_ads : p?.margin),
    },
    {
      chave: 'Markup', rotulo: `Markup${sufixo}`, valor: pct(markup, 0), hint: markup == null ? semLucro : parcial,
      variacao: variacaoPp(markup, apos ? p?.markup_after_ads : p?.markup),
    },
    {
      chave: 'Visitas dos anúncios acompanhados', rotulo: 'Visitas dos anúncios acompanhados', valor: t ? fmtInt(t.visits) : '—',
      hint: t ? `${fmtInt(t.listings)} anúncio${t.listings === 1 ? '' : 's'} · ${t.days_covered}/${t.days_in_month} dias` : 'dado indisponível', variacao: null,
    },
    {
      chave: 'Conversão dos anúncios acompanhados', rotulo: 'Conversão dos anúncios acompanhados', valor: t ? pct(t.conversion, 2) : '—',
      hint: t ? (t.conversion == null ? 'sem visitas no período' : `${fmtInt(t.orders)} pedido${t.orders === 1 ? '' : 's'} nesses anúncios`) : 'dado indisponível', variacao: null,
    },
    { chave: 'Vendas canceladas', rotulo: 'Vendas canceladas', valor: fmtInt(k.cancelled_orders), inverso: true, variacao: variacaoRel(k.cancelled_orders, p?.cancelled_orders, true) },
    {
      chave: 'Estornos', rotulo: 'Estornos', valor: brl(k.refunds_cents), inverso: true, hint: k.refunds_cents == null ? 'indisponível' : undefined,
      variacao: variacaoRel(k.refunds_cents, p?.refunds_cents, true),
    },
  ];
}

function GradeIndicadores({ report }: { report: MonthlyReport }) {
  const [expandido, setExpandido] = useState(false);
  const lista = cartoes(report);
  const vs = report.summary.previous ? `vs ${nomeDoMes(report.previous_month)}` : undefined;
  return (
    <section aria-label="Indicadores do mês">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {lista.map((c, i) => (
          <div key={c.chave} data-kpi={c.chave} className={cn(i >= VISIVEIS_MOBILE && !expandido && 'hidden lg:block')}>
            <KpiCard
              size="compact" label={c.rotulo} infoKey={`${c.chave}::${SUFIXO}`} value={c.valor}
              valueClassName={c.valor === '—' ? 'text-muted-foreground' : undefined}
              {...delta(c.variacao, c.inverso)} hint={c.hint ?? (c.variacao ? vs : undefined)}
            />
          </div>
        ))}
      </div>
      {!expandido && (
        <button type="button" onClick={() => setExpandido(true)}
          className="mt-3 min-h-11 w-full rounded-md border py-2 text-sm font-medium text-muted-foreground lg:hidden">
          Mostrar mais indicadores
        </button>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Visitas e conversão consideram só os anúncios acompanhados (com leitura diária válida); não são as visitas totais da loja.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Cascata do resultado (mesma do PDF)
// ---------------------------------------------------------------------------------------------
function Cascata({ k }: { k: PeriodKpis }) {
  // Saldos e valores vêm prontos do contrato (`linhasCascata`); aqui só a geometria da barra.
  const linhas = linhasCascata(k).map((l) => {
    const b = barraCascata(l, k.gross_cents);
    return { ...l, barra: b && { esq: b.esq * 100, larg: Math.max(b.larg * 100, l.valor === 0 ? 0 : 0.8) } };
  });

  return (
    <section aria-labelledby="cascata-t" className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="cascata-t" className="text-sm font-medium">Do faturamento ao lucro</h3>
          <p className="text-xs text-muted-foreground">Onde o faturamento da loja vai até virar lucro</p>
        </div>
        {k.profit_partial && <StatusPill tone="warning">Parcial · cobertura {pct(k.profit_coverage, 0)} do faturamento</StatusPill>}
      </div>
      <ul>
        {linhas.map((l, i) => {
          const menos = l.tipo === 'menos';
          const negativo = (l.valor ?? 0) < 0;
          return (
            <li key={l.rotulo} className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded px-2 py-2', i % 2 === 0 && 'bg-muted/30')}>
              <span className={cn('text-sm', menos ? 'text-muted-foreground' : 'font-medium', l.tipo === 'final' && 'font-semibold')}>
                {menos ? '– ' : i > 0 ? '= ' : ''}{l.rotulo}
              </span>
              <span className={cn('text-right text-sm tabular-nums', l.valor == null ? 'text-muted-foreground' : !menos && 'font-semibold', l.tipo === 'final' && l.valor != null && 'text-base text-primary')}>
                {l.valor == null ? '—' : menos ? `– ${brl(Math.abs(l.valor))}` : brl(l.valor)}
              </span>
              {l.valor == null ? (
                l.sub && <span className="col-span-2 text-xs text-muted-foreground">{l.sub}</span>
              ) : l.barra && (
                <span aria-hidden className="relative col-span-2 h-2 rounded-full bg-muted/60">
                  <span
                    className={cn('absolute inset-y-0 rounded-full', negativo ? 'bg-destructive' : l.tipo === 'final' ? 'bg-chart-2' : l.tipo === 'total' ? 'bg-chart-1' : 'bg-chart-5')}
                    style={{ left: `${l.barra.esq}%`, width: `${l.barra.larg}%` }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {(k.profit_partial || k.excluded_items > 0) && (
        <Faixa tom="aviso">
          <span>
            <strong>Itens sem lucro calculável: {fmtInt(k.excluded_items)}</strong> ({brl(k.excluded_gross_cents)} de faturamento fora do lucro).
            O líquido considera todos os itens; custo, lucro e margens consideram só os itens com lucro calculável.
          </span>
        </Faixa>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Principais produtos do mês
// ---------------------------------------------------------------------------------------------
const COR_CLASSE: Record<string, string> = { A: 'bg-chart-1', B: 'bg-chart-2', C: 'bg-chart-3' };

function Produtos({ tf }: { tf: TopFamilies | null }) {
  const rows = tf?.rows.slice(0, 5) ?? [];
  const algumParcial = rows.some((r) => r.partial);
  return (
    <section aria-labelledby="prod-t" className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div>
        <h3 id="prod-t" className="text-sm font-medium">Principais produtos do mês</h3>
        <p className="text-xs text-muted-foreground">Por família, ordenado por faturamento</p>
      </div>
      {!tf ? (
        <Faixa tom="aviso" role="status">Indisponível: o catálogo de famílias não pôde ser lido neste momento.</Faixa>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Sem vendas de produtos com código no mês.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Cinco principais famílias de produtos do mês</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="w-6 py-2 pr-2 font-medium">#</th>
                <th scope="col" className="py-2 pr-3 font-medium">Produto</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Un.</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Faturamento</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">% mês</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Lucro</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium md:table-cell">Margem s/ venda</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium md:table-cell">Markup</th>
                <th scope="col" className="hidden py-2 text-center font-medium sm:table-cell">Classe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-2.5 pr-2 text-muted-foreground">{n + 1}</td>
                  <td className="py-2.5 pr-3 sm:max-w-xs">
                    <span className="line-clamp-2 font-medium" title={r.name ?? `Código ${r.key}`}>{r.name ?? `Código ${r.key}`}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">
                      {fmtInt(r.units)} un. · lucro {brl(r.profit_cents)}{r.partial && r.profit_cents != null ? '*' : ''}{r.class ? ` · classe ${r.class}` : ''}
                    </span>
                  </td>
                  <td className="hidden py-2.5 pr-3 text-right sm:table-cell">{fmtInt(r.units)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium">{brl(r.gross_cents)}</td>
                  <td className="hidden py-2.5 pr-3 text-right sm:table-cell">{pct(r.share)}</td>
                  <td className={cn('hidden whitespace-nowrap py-2.5 pr-3 text-right sm:table-cell', r.profit_cents == null && 'text-muted-foreground')}>{brl(r.profit_cents)}{r.partial && r.profit_cents != null ? '*' : ''}</td>
                  <td className={cn('hidden py-2.5 pr-3 text-right md:table-cell', r.margin == null && 'text-muted-foreground')}>{pct(r.margin)}</td>
                  <td className={cn('hidden py-2.5 pr-3 text-right md:table-cell', r.markup == null && 'text-muted-foreground')}>{pct(r.markup, 0)}</td>
                  <td className="hidden py-2.5 text-center sm:table-cell">
                    {r.class ? <span className="inline-flex items-center gap-1.5 text-xs font-medium"><span aria-hidden className={cn('size-2 rounded-full', COR_CLASSE[r.class])} />{r.class}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tf && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p><strong className="text-foreground">Top 5 = {pct(tf.top_share, 0)} do faturamento.</strong> {algumParcial ? '* Lucro parcial: só itens com lucro calculável. ' : ''}Margem s/ venda e markup antes de Ads.</p>
          {tf.without_code_gross_cents > 0 && <p>Vendas sem código de produto (fora do ranking): {brl(tf.without_code_gross_cents)}</p>}
          {tf.unknown_family_gross_cents > 0 && <p>Família desconhecida (fora do ranking): {brl(tf.unknown_family_gross_cents)}</p>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------------------------
function motivoAds(ads: AdsKpis | null): string {
  if (!ads) return 'Dados de Ads indisponíveis neste momento.';
  if (ads.coverage === 'none') return 'Sem coleta de Ads para este período.';
  return `Cobertura parcial do mês (${ads.days_covered} de ${ads.days_expected} dias): as métricas de Ads não são exibidas para não induzir a erro.`;
}

function BlocoAds({ ads }: { ads: AdsKpis | null }) {
  const completo = ads?.coverage === 'complete';
  const prazo = ads?.attribution_expected_final_on ? ads.attribution_expected_final_on.slice(8, 10) + '/' + ads.attribution_expected_final_on.slice(5, 7) : null;
  const itens: Array<[string, string, string, string]> = ads && completo ? [
    ['Investimento', brl(ads.cost_cents), 'Investimento::Ads', 'Investimento'],
    ['Receita atribuída', brl(ads.revenue_cents), 'Receita Ads::Ads', 'Receita atribuída'],
    ['ROAS', razaoX(ads.roas), 'ROAS::Ads', 'ROAS'],
    ['ACOS', pct(ads.acos), 'ACOS::Ads', 'ACOS'],
    ['TACOS', pct(ads.tacos), 'TACOS da conta::Ads', 'TACOS'],
    ['Impressões', ads.prints == null ? '—' : fmtInt(ads.prints), 'Impressões::Ads', 'Impressões'],
    ['Cliques', ads.clicks == null ? '—' : fmtInt(ads.clicks), 'Cliques::Ads', 'Cliques'],
    ['CTR', pct(ads.ctr, 2), 'CTR::Ads', 'CTR'],
    ['CPC', brl(ads.cpc_cents), 'CPC::Ads', 'CPC'],
  ] : [];
  return (
    <section aria-labelledby="ads-t" className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="ads-t" className="text-sm font-medium">Anúncios patrocinados (Mercado Ads)</h3>
          <p className="text-xs text-muted-foreground">Conta inteira, no mês</p>
        </div>
        {completo && ads.attribution === 'open' && <StatusPill tone="warning">Atribuição do ML em fechamento{prazo ? ` até ${prazo}` : ''}</StatusPill>}
        {completo && ads.attribution === 'final' && <StatusPill tone="success">Atribuição final</StatusPill>}
      </div>
      {!completo ? (
        <Faixa tom="aviso" role="status"><strong>Ads indisponível:</strong> {motivoAds(ads)}</Faixa>
      ) : (
        <>
          {ads.attribution === 'open' && <p className="text-xs text-muted-foreground">Valores podem variar levemente até o ML fechar a atribuição.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {itens.map(([chave, valor, infoKey, rotulo]) => (
              <KpiCard key={chave} size="compact" label={rotulo} infoKey={infoKey} value={valor} valueClassName={valor === '—' ? 'text-muted-foreground' : undefined} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Aba
// ---------------------------------------------------------------------------------------------
function Esqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" role="status" aria-label="Carregando resultados">
      <div className="grid gap-3 md:grid-cols-2"><KpiCard loading label="" value="" /><KpiCard loading label="" value="" /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <KpiCard key={i} size="compact" loading label="" value="" />)}</div>
      <Skeleton className="h-80" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
    </div>
  );
}

export function OrgResults({ report: query }: { report: UseQueryResult<MonthlyReport> }) {
  const report = query.data;
  if (query.isLoading || (!report && !query.isError)) return <Esqueleto />;
  if (!report) {
    return (
      <Faixa tom="erro" role="alert">
        <span>Não foi possível carregar os resultados da organização.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
      </Faixa>
    );
  }

  const k = report.summary.current;
  const erros = report.warnings.filter((w) => w.severity === 'error');
  const avisos = report.warnings.filter((w) => w.severity === 'warning');
  const semVenda = k.orders === 0 && k.gross_cents === 0;
  // Pela quantidade de competências: mês não calculado é lacuna, não some com a série inteira.
  const evolucao = report.series.length > 1;
  const motivoSemLucro = MOTIVO_APOS_ADS[k.unavailable_reason ?? ''] ?? 'dado ausente';

  return (
    <div className="space-y-4">
      {query.isError && (
        <Faixa tom="erro" role="alert">
          <span>A atualização dos resultados falhou; os últimos dados disponíveis permanecem na tela.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </Faixa>
      )}
      {erros.length > 0 && (
        <Faixa tom="erro" role="alert">
          <div className="space-y-1">{erros.map((w) => <p key={w.code}>{w.message}</p>)}</div>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </Faixa>
      )}
      {avisos.length > 0 && <Faixa tom="aviso"><div className="space-y-1">{avisos.map((w) => <p key={w.code}>{w.message}</p>)}</div></Faixa>}

      {semVenda ? (
        // Vazio só no bloco de vendas: Ads, visitas, cancelamentos e estornos do mês seguem conhecidos.
        <>
          <EmptyState icon={BarChart3} title={`Sem vendas em ${mesPorExtenso(report.month)}`}
            description="Não há pedidos faturáveis neste mês; os demais indicadores conhecidos seguem abaixo." />
          <GradeIndicadores report={report} />
          {evolucao && <EvolucaoMensal series={report.series} />}
          <BlocoAds ads={report.ads} />
        </>
      ) : (
        <>
          <Destaques report={report} />
          <GradeIndicadores report={report} />
          <GraficoDiario report={report} motivoSemLucro={motivoSemLucro} />
          <div className={cn('grid gap-4', evolucao && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
            {evolucao && <EvolucaoMensal series={report.series} />}
            <Cascata k={k} />
          </div>
          <Produtos tf={report.top_families} />
          <BlocoAds ads={report.ads} />
        </>
      )}

      <p className="text-xs text-muted-foreground">Lido em {dataHoraBr(report.generated_at)} · mesma fonte do relatório mensal em PDF.</p>
    </div>
  );
}
