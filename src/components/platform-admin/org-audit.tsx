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
  failed: 'Falha (suporte/Sonar)',
  denied: 'Negado (suporte)',
  intent: 'Iniciado (admin)',
  ready: 'Concluído (Sonar)',
  partial: 'Parcial (Sonar)',
  // O Sonar já grava estes três hoje (`platform_sonar_events.outcome`, migration
  // 20260906170100): `billable` é a entrega que vale unidade, `exempt` a isenta (Daludi ou
  // reabertura) e `collect` o início da coleta. Faltavam aqui, então eram infiltráveis.
  billable: 'Faturável (Sonar)',
  exempt: 'Isento (Sonar)',
  collect: 'Coleta (Sonar)',
};

// As três fontes usam vocabulário próprio para a mesma ideia: o admin grava `success`/`failure`,
// o suporte `succeeded`/`failed` (enum) e o Sonar `ready`/`failed`. Tratar só `success` como verde
// pintava de cinza todo evento de suporte bem-sucedido — que hoje é a totalidade da auditoria real.
function resultTone(result: string): 'success' | 'danger' | 'neutral' {
  if (['success', 'succeeded', 'ready'].includes(result)) return 'success';
  if (['failure', 'failed', 'denied'].includes(result)) return 'danger';
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
    { key: 'at', header: 'Data', className: 'tabular-nums', cell: (row) => new Date(row.at).toLocaleString('pt-BR') },
    { key: 'category', header: 'Categoria', cell: (row) => <StatusPill tone="neutral">{CATEGORIAS[row.category]}</StatusPill> },
    { key: 'action', header: 'Ação', cell: (row) => <code className="text-xs">{row.action}</code> },
    {
      key: 'actor', header: 'Responsável',
      className: 'whitespace-normal break-words',
      cell: (row) => row.actor_id ? (
        <button
          type="button"
          title={`UUID: ${row.actor_id}`}
          aria-label={`Filtrar pelo responsável ${row.actor_name ?? 'Sistema'}`}
          onClick={() => { setActorId(row.actor_id as string); setPage(1); }}
          className="-mx-1 min-h-9 rounded px-1 text-left underline decoration-dotted underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.actor_name ?? 'Sistema'}
        </button>
      ) : <span>{row.actor_name ?? 'Sistema'}</span>,
    },
    { key: 'result', header: 'Resultado', cell: (row) => <StatusPill tone={resultTone(row.result)}>{RESULTADOS[row.result] ?? row.result}</StatusPill> },
    { key: 'target', header: 'Alvo', className: 'whitespace-normal break-words', cell: (row) => row.target ?? '—' },
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
                  <Button variant="ghost" size="sm" className="min-h-9" title={`Ver detalhes de ${row.action}`}>Ver</Button>
                </PopoverTrigger>
                <PopoverContent className="max-h-[60vh] overflow-y-auto">
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
    <div className="space-y-4" aria-busy={query.isFetching || undefined}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[12rem_minmax(0,20rem)_14rem]">
        <div className="space-y-1.5">
          <label htmlFor="audit-categoria" className="text-xs font-medium text-muted-foreground">Categoria</label>
          <Select
            value={category || CATEGORIA_TODAS}
            onValueChange={(value) => { setCategory(value === CATEGORIA_TODAS ? '' : value as AuditRow['category']); setPage(1); }}
          >
            <SelectTrigger id="audit-categoria" aria-label="Categoria" className="h-10 w-full sm:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CATEGORIA_TODAS}>Todas</SelectItem>
              {Object.entries(CATEGORIAS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="audit-responsavel" className="text-xs font-medium text-muted-foreground">Responsável (UUID)</label>
          <Input
            id="audit-responsavel"
            className="h-10 w-full sm:h-9"
            aria-label="Responsável"
            aria-describedby="audit-responsavel-ajuda"
            value={actorId}
            onChange={(event) => { setActorId(event.target.value); setPage(1); }}
            placeholder="UUID do responsável"
            title="Filtra pelo UUID exato do responsável — passe o mouse sobre o nome na coluna Responsável para ver o dele."
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="audit-resultado" className="text-xs font-medium text-muted-foreground">Resultado</label>
          <Select
            value={result || RESULTADO_TODOS}
            onValueChange={(value) => { setResult(value === RESULTADO_TODOS ? '' : value); setPage(1); }}
          >
            <SelectTrigger id="audit-resultado" aria-label="Resultado" className="h-10 w-full sm:h-9">
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
        <p id="audit-responsavel-ajuda" className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
          O filtro de responsável usa o UUID exato. Selecione um nome na coluna Responsável para preencher o campo.
        </p>
      </div>

      {query.isError && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          <span>Não foi possível carregar a auditoria.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </div>
      )}

      {!(query.isError && !audit) && (
        <DataTable<AuditRow>
          columns={columns}
          rows={audit?.rows ?? []}
          rowKey={(row) => row.id}
          loading={query.isLoading || (!audit && !query.isError)}
          skeletonRows={5}
          empty={<EmptyState icon={ScrollText} title="Nenhum evento encontrado" />}
        />
      )}

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
