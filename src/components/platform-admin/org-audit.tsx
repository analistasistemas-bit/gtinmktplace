import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { usePlatformAudit } from '@/hooks/usePlatformAdmin';
import type { AuditRow } from '@/lib/platform-admin';

const PAGE_SIZE = 20;
const CATEGORIA_TODAS = '__todas';
const RESULTADO_TODOS = '__todos';

const CATEGORIAS: Record<AuditRow['category'], string> = {
  admin: 'Administração',
  billing: 'Cobrança',
  pulse: 'Pulse',
  support: 'Suporte',
};

/**
 * `result` é texto livre gravado por origens diferentes (platform_audit_events, eventos do
 * Sonar, eventos de suporte) — sem CHECK no banco, e o filtro compara igualdade exata (ver
 * `repository.ts`). Esta lista cobre os valores reais em uso hoje, traduzidos; se uma ação nova
 * passar a gravar outro valor, ele fica invisível no filtro até alguém adicionar aqui (não há
 * como listar dinamicamente sem uma consulta extra ao backend, fora do escopo desta correção).
 */
const RESULTADOS: Record<string, string> = {
  success: 'Sucesso (admin/cobrança)',
  succeeded: 'Sucesso (suporte)',
  failure: 'Falha (admin)',
  failed: 'Falha (suporte)',
  denied: 'Negado (suporte)',
  intent: 'Iniciado (admin)',
  ready: 'Concluído (Sonar)',
  partial: 'Parcial (Sonar)',
};

function resultTone(result: string): 'success' | 'danger' | 'neutral' {
  if (result === 'success') return 'success';
  if (['failed', 'error', 'denied'].includes(result)) return 'danger';
  return 'neutral';
}

export function OrgAudit({ orgId, month }: { orgId: string; month: string }) {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<AuditRow['category'] | ''>('');
  const [actorId, setActorId] = useState('');
  const [result, setResult] = useState('');
  const query = usePlatformAudit({
    org_id: orgId,
    month,
    category: category || undefined,
    actor_id: actorId.trim() || undefined,
    result: result.trim() || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const audit = query.data;

  const columns: Column<AuditRow>[] = [
    { key: 'at', header: 'Data', cell: (row) => new Date(row.at).toLocaleString('pt-BR') },
    { key: 'category', header: 'Categoria', cell: (row) => <StatusPill tone="neutral">{CATEGORIAS[row.category]}</StatusPill> },
    { key: 'action', header: 'Ação', cell: (row) => <code className="text-xs">{row.action}</code> },
    {
      key: 'actor', header: 'Responsável',
      cell: (row) => <span title={row.actor_id ? `UUID: ${row.actor_id}` : undefined}>{row.actor_name ?? 'Sistema'}</span>,
    },
    { key: 'result', header: 'Resultado', cell: (row) => <StatusPill tone={resultTone(row.result)}>{RESULTADOS[row.result] ?? row.result}</StatusPill> },
    { key: 'target', header: 'Alvo', cell: (row) => row.target ?? '—' },
    {
      key: 'details',
      header: 'Detalhes',
      cell: (row) => {
        const hasDetails = Object.keys(row.details).length > 0;
        return (
          <div className="flex flex-col items-start gap-1">
            {hasDetails ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm">Ver</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <pre className="max-w-sm whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(row.details, null, 2)}
                  </pre>
                </PopoverContent>
              </Popover>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {row.reason && <span className="text-xs text-muted-foreground">{row.reason}</span>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={category || CATEGORIA_TODAS}
          onValueChange={(value) => { setCategory(value === CATEGORIA_TODAS ? '' : value as AuditRow['category']); setPage(1); }}
        >
          <SelectTrigger aria-label="Categoria" className="h-8 w-[10rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CATEGORIA_TODAS}>Todas</SelectItem>
            {Object.entries(CATEGORIAS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-8 w-48"
          aria-label="Responsável"
          value={actorId}
          onChange={(event) => { setActorId(event.target.value); setPage(1); }}
          placeholder="UUID do responsável"
          title="Filtra pelo UUID exato do responsável — passe o mouse sobre o nome na coluna Responsável para ver o dele."
        />
        <Select
          value={result || RESULTADO_TODOS}
          onValueChange={(value) => { setResult(value === RESULTADO_TODOS ? '' : value); setPage(1); }}
        >
          <SelectTrigger aria-label="Resultado" className="h-8 w-[11rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={RESULTADO_TODOS}>Todos</SelectItem>
            {Object.entries(RESULTADOS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          Não foi possível carregar a auditoria.{' '}
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </div>
      )}

      <DataTable<AuditRow>
        columns={columns}
        rows={audit?.rows ?? []}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        skeletonRows={5}
        empty={<EmptyState icon={ScrollText} title="Nenhum evento encontrado" />}
      />

      {audit && audit.total > audit.page_size && (
        <Pagination
          paginaAtual={page}
          totalPaginas={Math.max(1, Math.ceil(audit.total / audit.page_size))}
          inicio={(page - 1) * audit.page_size + 1}
          fim={Math.min(page * audit.page_size, audit.total)}
          total={audit.total}
          tamanho={audit.page_size}
          onIrPara={setPage}
          onTamanho={() => undefined}
          rotuloItem="evento"
          tamanhos={[audit.page_size]}
        />
      )}
    </div>
  );
}
