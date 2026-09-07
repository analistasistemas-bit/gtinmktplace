import { useEffect, useState } from 'react';
import { Coins, Radar, RotateCcw, Users, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type Column, DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { Pagination } from '@/components/ui/pagination';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { usePlatformPulseUsage } from '@/hooks/usePlatformAdmin';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type { PulseUsageRow } from '@/lib/platform-admin';

const PAGE_SIZE = 20;

function resultTone(result: string): StatusTone {
  if (result === 'completed') return 'success';
  if (result === 'failed') return 'danger';
  return 'neutral';
}

const columns: Column<PulseUsageRow>[] = [
  { key: 'at', header: 'Data', cell: (row) => new Date(row.at).toLocaleString('pt-BR') },
  {
    key: 'query', header: 'Consulta',
    cell: (row) => (
      <div>
        <span className="font-medium">{row.query}</span>
        <span className="block text-xs text-muted-foreground">{row.query_type}</span>
      </div>
    ),
  },
  { key: 'actor', header: 'Pessoa', cell: (row) => row.actor_name ?? row.actor_id },
  {
    key: 'origin', header: 'Origem',
    cell: (row) => row.origin === 'daludi'
      ? <StatusPill tone="info">Daludi</StatusPill>
      : <StatusPill tone="neutral">Cliente</StatusPill>,
  },
  {
    key: 'result', header: 'Resultado',
    cell: (row) => <StatusPill tone={resultTone(row.result)}>{row.result}</StatusPill>,
  },
  { key: 'units', header: 'Unidades', className: 'text-right tabular-nums', cell: (row) => row.units },
  { key: 'exempt', header: 'Isenção', cell: (row) => row.exempt_reason ?? '—' },
];

export function OrgPulse({ orgId, month }: { orgId: string; month: string }) {
  const [page, setPage] = useState(1);
  // Trocar organização/mês sem voltar a página 1 pede uma página que não existe mais no novo
  // recorte: a lista some e o EmptyState mente "sem consulta" onde o problema é paginação.
  useEffect(() => setPage(1), [orgId, month]);
  const query = usePlatformPulseUsage({ org_id: orgId, month, page, page_size: PAGE_SIZE });
  const usage = query.data;
  // react-query v5: `isLoading` é `isPending && isFetching` — enabled:false (usuário ainda não
  // resolvido) deixa isLoading=false e data=undefined, confundindo "ainda não carregou" com "sem dado".
  const loading = query.isLoading || (!usage && !query.isError);

  if (query.isError && !usage) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <span>Não foi possível carregar o consumo do Pulse.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const totalPages = usage ? Math.max(1, Math.ceil(usage.total / usage.page_size)) : 1;

  return (
    <div className="space-y-4">
      {query.isError && usage && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>A atualização do consumo falhou; os últimos dados disponíveis permanecem na tela.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          size="compact" loading={loading} icon={Radar} label="Unidades do cliente"
          value={usage ? fmtInt(usage.client_units) : undefined}
        />
        <KpiCard
          size="compact" loading={loading} icon={Users} label="Consultas Daludi"
          value={usage ? fmtInt(usage.daludi_searches) : undefined}
        />
        <KpiCard
          size="compact" loading={loading} icon={XCircle} label="Falhas"
          tom={usage && usage.failures > 0 ? 'danger' : 'success'}
          value={usage ? fmtInt(usage.failures) : undefined}
        />
        <KpiCard
          size="compact" loading={loading} icon={RotateCcw} label="Reaberturas"
          value={usage ? fmtInt(usage.reopens) : undefined}
        />
        <KpiCard
          size="compact" loading={loading} icon={Coins} label="Custo medido"
          value={usage ? (usage.measured_cost_cents == null ? '—' : fmtBRL(usage.measured_cost_cents / 100)) : undefined}
          hint="Sem medição do fornecedor"
        />
      </div>

      {usage?.tracked_since && (
        <p className="text-xs text-muted-foreground">
          Rastreado desde {new Date(usage.tracked_since).toLocaleDateString('pt-BR')}.
        </p>
      )}

      <DataTable
        columns={columns}
        rows={usage?.rows ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        empty={<EmptyState icon={Radar} title="Nenhuma consulta no período" />}
      />

      {usage && usage.total > usage.page_size && (
        <Pagination
          paginaAtual={page}
          totalPaginas={totalPages}
          inicio={(page - 1) * usage.page_size + 1}
          fim={(page - 1) * usage.page_size + usage.rows.length}
          total={usage.total}
          tamanho={usage.page_size}
          onIrPara={setPage}
          onTamanho={() => undefined}
          rotuloItem="consulta"
          tamanhos={[usage.page_size]}
        />
      )}
    </div>
  );
}
