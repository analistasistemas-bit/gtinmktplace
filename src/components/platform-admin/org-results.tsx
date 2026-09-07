import { LineChart as LineChartIcon, Receipt, ShoppingBag, Tag, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard, type DeltaTrend } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlatformMetrics } from '@/hooks/usePlatformAdmin';
import { fmtBRL, fmtInt, fmtMarkup, fmtMilhar } from '@/lib/formato';

const money = (cents: number | null | undefined) => cents == null ? '—' : fmtBRL(cents / 100);

function deltaPct(current: number, previous: number): string | undefined {
  if (previous <= 0) return undefined;
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function OrgResults({ orgId, month }: { orgId: string; month: string }) {
  const query = usePlatformMetrics(orgId, month);
  const metrics = query.data;
  // react-query v5: `isLoading` é `isPending && isFetching` — uma query ainda `enabled: false`
  // (ex.: usuário não resolvido num refresh direto na URL do detalhe) fica com isLoading=false e
  // data=undefined, o que confundiria "sem dado" com "ainda não carregou".
  const loading = query.isLoading || (!metrics && !query.isError);

  if (query.isError && !metrics) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <span>Não foi possível carregar os resultados da organização.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const previous = metrics?.previous ?? null;
  const delta = metrics && previous ? deltaPct(metrics.gross_cents, previous.gross_cents) : undefined;
  const previousDifference = metrics && previous ? metrics.gross_cents - previous.gross_cents : null;
  // Sinal vem do número, nunca da string formatada (ICU pode emitir um "−" que `startsWith('-')`
  // não reconhece, e o card pintaria queda de receita como alta).
  const deltaTrend: DeltaTrend = previousDifference == null ? 'neutral' : previousDifference >= 0 ? 'up' : 'down';
  const hasOrders = (metrics?.total_orders ?? 0) > 0;
  const coverage = metrics && hasOrders
    ? `${metrics.cost_covered_orders}/${metrics.total_orders} (${Math.round((metrics.cost_covered_orders / metrics.total_orders) * 100)}%)`
    : null;

  return (
    <div className="space-y-4">
      {query.isError && metrics && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>A atualização dos resultados falhou; os últimos dados disponíveis permanecem na tela.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          size="compact" loading={loading} icon={Receipt} label="Faturamento bruto"
          value={metrics ? money(metrics.gross_cents) : undefined}
          delta={delta} deltaTrend={deltaTrend} hint="vs. mesmo período do mês anterior"
        />
        <KpiCard
          size="compact" loading={loading} icon={ShoppingBag} label="Pedidos"
          value={metrics ? fmtInt(metrics.orders) : undefined}
        />
        <KpiCard
          size="compact" loading={loading} icon={Tag} label="Ticket médio"
          value={metrics ? money(metrics.ticket_cents) : undefined}
        />
        <KpiCard
          size="compact" loading={loading} icon={TrendingUp} label="Markup"
          value={metrics ? fmtMarkup(metrics.markup) : undefined}
          valueClassName={metrics?.markup == null ? undefined : metrics.markup >= 0 ? 'text-success' : 'text-destructive'}
          hint={metrics == null ? undefined
            : metrics.markup == null ? 'Sem custo ou alíquota confirmada'
            : `${metrics.cost_covered_orders}/${metrics.total_orders} pedidos com custo`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Evolução de seis meses</CardTitle>
            <CardDescription>Faturamento bruto por mês-calendário</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64" />
            ) : !metrics || metrics.series.length === 0 ? (
              <EmptyState icon={LineChartIcon} title="Sem histórico disponível para o período" />
            ) : (
              <div className="h-64 w-full" role="img" aria-label="Faturamento bruto dos últimos seis meses">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      tickFormatter={(value) => fmtMilhar(Number(value) / 100)}
                      width={48}
                    />
                    <Tooltip formatter={(value) => [money(Number(value)), 'Faturamento']} />
                    <Line type="monotone" dataKey="gross_cents" stroke="var(--primary)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Operação</CardTitle></CardHeader>
          <CardContent>
            {loading || !metrics ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground" title="Mesmo tempo decorrido do mês anterior">Período anterior</dt>
                  <dd className="tabular-nums" title={previous ? undefined : 'Sem mês anterior para comparar'}>
                    {previous ? money(previous.gross_cents) : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Variação absoluta</dt>
                  <dd className="tabular-nums" title={previous ? undefined : 'Sem mês anterior para comparar'}>
                    {previousDifference == null ? '—' : money(previousDifference)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Cobertura de custo</dt>
                  <dd className="tabular-nums" title={coverage ? undefined : 'Sem pedidos no mês'}>
                    {coverage ?? '—'}
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      {metrics && metrics.warnings.some((warning) => warning.severity === 'error') && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <div className="space-y-1">
            {metrics.warnings.filter((warning) => warning.severity === 'error').map((warning) => <p key={warning.code}>{warning.message}</p>)}
          </div>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </div>
      )}
      {metrics && metrics.warnings.some((warning) => warning.severity === 'warning') && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          {metrics.warnings.filter((warning) => warning.severity === 'warning').map((warning) => <p key={warning.code}>{warning.message}</p>)}
        </div>
      )}
    </div>
  );
}
