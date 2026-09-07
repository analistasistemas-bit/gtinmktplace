import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePlatformPulseUsage } from '@/hooks/usePlatformAdmin';
import { fmtBRL } from '@/lib/formato';

const PAGE_SIZE = 20;
const unavailable = 'Indisponível';

export function OrgPulse({ orgId, month }: { orgId: string; month: string }) {
  const [page, setPage] = useState(1);
  const query = usePlatformPulseUsage({ org_id: orgId, month, page, page_size: PAGE_SIZE });
  const usage = query.data;

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Carregando consumo do Pulse…</p>;
  if (!usage) {
    return <p className="text-sm text-destructive" role="alert">Não foi possível carregar o consumo do Pulse.</p>;
  }

  const totalPages = Math.max(1, Math.ceil(usage.total / usage.page_size));
  return (
    <div className="space-y-4">
      {query.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          A atualização do consumo falhou; os últimos dados disponíveis permanecem na tela.
        </p>
      )}
      {query.isStale && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status">
          O consumo exibido pode estar desatualizado.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Unidades do cliente', usage.client_units.toLocaleString('pt-BR')],
          ['Consultas Daludi', usage.daludi_searches.toLocaleString('pt-BR')],
          ['Falhas', usage.failures.toLocaleString('pt-BR')],
          ['Reaberturas', usage.reopens.toLocaleString('pt-BR')],
          ['Custo medido', usage.measured_cost_cents == null ? unavailable : fmtBRL(usage.measured_cost_cents / 100)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {usage.tracked_since && (
        <p className="text-xs text-muted-foreground">
          Rastreado desde {new Date(usage.tracked_since).toLocaleDateString('pt-BR')}.
        </p>
      )}

      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead><TableHead>Consulta</TableHead><TableHead>Pessoa</TableHead>
              <TableHead>Origem</TableHead><TableHead>Resultado</TableHead><TableHead>Unidades</TableHead>
              <TableHead>Isenção</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{new Date(row.at).toLocaleString('pt-BR')}</TableCell>
                <TableCell><span className="font-medium">{row.query}</span><span className="block text-xs text-muted-foreground">{row.query_type}</span></TableCell>
                <TableCell>{row.actor_name ?? row.actor_id}</TableCell>
                <TableCell>{row.origin === 'daludi' ? 'Daludi' : 'Cliente'}</TableCell>
                <TableCell>{row.result}</TableCell>
                <TableCell className="tabular-nums">{row.units}</TableCell>
                <TableCell>{row.exempt_reason ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-3 md:hidden">
        {usage.rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="space-y-2 p-4 text-sm">
              <div><p className="font-medium">{row.query}</p><p className="text-xs text-muted-foreground">{new Date(row.at).toLocaleString('pt-BR')}</p></div>
              <dl className="grid grid-cols-2 gap-2">
                <div><dt className="text-xs text-muted-foreground">Pessoa</dt><dd>{row.actor_name ?? row.actor_id}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Origem</dt><dd>{row.origin === 'daludi' ? 'Daludi' : 'Cliente'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Resultado</dt><dd>{row.result}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Isenção</dt><dd>{row.exempt_reason ?? '—'}</dd></div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {usage.rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma consulta no período.</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Página {page} de {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
        </div>
      </div>
    </div>
  );
}
