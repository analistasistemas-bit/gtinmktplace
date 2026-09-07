import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePlatformMetrics } from '@/hooks/usePlatformAdmin';
import { fmtBRL } from '@/lib/formato';

const unavailable = 'Indisponível';
const money = (cents: number | null | undefined) => cents == null ? unavailable : fmtBRL(cents / 100);

export function OrgResults({ orgId, month }: { orgId: string; month: string }) {
  const query = usePlatformMetrics(orgId, month);
  const metrics = query.data;

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Carregando resultados…</p>;
  if (!metrics) {
    return <p className="text-sm text-destructive" role="alert">Não foi possível carregar os resultados da organização.</p>;
  }

  const coverage = metrics.total_orders > 0
    ? `${metrics.cost_covered_orders}/${metrics.total_orders} (${Math.round((metrics.cost_covered_orders / metrics.total_orders) * 100)}%)`
    : unavailable;
  const previousDifference = metrics.previous
    ? metrics.gross_cents - metrics.previous.gross_cents
    : null;

  return (
    <div className="space-y-4">
      {query.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          A atualização dos resultados falhou; os últimos dados disponíveis permanecem na tela.
        </p>
      )}
      {query.isStale && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status">
          Os resultados exibidos podem estar desatualizados.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Faturamento bruto', money(metrics.gross_cents)],
          ['Pedidos', metrics.orders.toLocaleString('pt-BR')],
          ['Ticket médio', money(metrics.ticket_cents)],
          ['Markup', metrics.markup == null ? unavailable : `${metrics.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader><CardTitle>Evolução de seis meses</CardTitle></CardHeader>
          <CardContent>
            {metrics.series.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem histórico disponível para o período.</p>
            ) : (
              <div className="h-64 w-full" role="img" aria-label="Faturamento bruto dos últimos seis meses">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      tickFormatter={(value) => money(Number(value))}
                      width={72}
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
          <CardHeader><CardTitle>Comparação e cobertura</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Período anterior</dt><dd>{money(metrics.previous?.gross_cents)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Variação absoluta</dt><dd>{money(previousDifference)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cobertura de custo</dt><dd>{coverage}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Pendências</dt><dd>{metrics.pending_operations ?? unavailable}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Anúncios ativos</dt><dd>{metrics.active_ads ?? unavailable}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Publicações</dt><dd>{metrics.publications ?? unavailable}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {(metrics.active_ads == null || metrics.publications == null || metrics.pending_operations == null) && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status">
          Parte das contagens operacionais ainda não está disponível para este período.
        </p>
      )}
      {metrics.warnings.map((warning) => <p key={warning} className="text-sm text-muted-foreground">{warning}</p>)}
    </div>
  );
}
