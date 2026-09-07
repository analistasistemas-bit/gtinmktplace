import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Search, AlertTriangle, ArrowUp, ArrowDown, ArrowRight, Building2, Receipt,
  Wallet as WalletIcon, MoreHorizontal,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { KpiCard, KpiInfoButton } from '@/components/ui/kpi-card';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePlatformWallet } from '@/hooks/usePlatformAdmin';
import type { OrgSummary, WalletTotals } from '@/lib/platform-admin';
import { fmtBRL, fmtInt, fmtMarkup } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { cancelSupport, listSupportRequests, type SupportRequest } from '@/lib/suporte';
import { useSupportStore } from '@/stores/support-store';
import { SupportRequestDialog } from '@/components/platform-admin/support-request-dialog';

const PAGE_SIZE = 10;

function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Estado de uma solicitação de suporte em relação às ações disponíveis na linha/menu. */
function supportFlags(request?: SupportRequest) {
  const canStart = request?.status === 'approved'
    && Boolean(request.approval_expires_at)
    && new Date(request.approval_expires_at!).getTime() > Date.now();
  const canRenew = request?.status === 'active'
    && Boolean(request.expires_at)
    && new Date(request.expires_at!).getTime() > Date.now()
    && new Date(request.expires_at!).getTime() - Date.now() <= 15 * 60_000;
  const canRequest = !request || !['pending', 'active'].includes(request.status);
  return { canStart, canRenew, canRequest };
}

// callUsuarios é a mesma edge que create_org (NovaOrgDialog, mantido como está pela T8) usava antes
// do redesign — segue necessária mesmo com Excluir/Canais/Módulos removidos daqui.
async function callUsuarios(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('usuarios', { body });
  if (error) {
    // Em respostas não-2xx o invoke não popula `data`; a mensagem real está no corpo (error.context).
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      } catch {
        /* mantém error.message */
      }
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Card de destaque do topo (Faturamento bruto da carteira). Mesma estrutura de HeroVenda
 *  (Dashboard.tsx), mas não-linkável: é um agregado da carteira, não o drill-down de uma org. */
function HeroCarteira({ totals, orgs, loading, className }: {
  totals?: WalletTotals;
  orgs: OrgSummary[];
  loading: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cn('h-full rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm', className)}>
        <div className="mb-1 flex items-center gap-1.5 text-xs text-info">
          <Receipt className="h-4 w-4 shrink-0" /> Faturamento bruto
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }

  const comPrevio = orgs.length > 0 && orgs.every((o) => (o.metrics?.previous?.gross_cents ?? 0) > 0);
  let delta: { texto: string; up: boolean } | null = null;
  if (comPrevio) {
    const prevSum = orgs.reduce((soma, o) => soma + o.metrics!.previous!.gross_cents, 0);
    const curSum = orgs.reduce((soma, o) => soma + (o.metrics?.gross_cents ?? 0), 0);
    const pct = ((curSum - prevSum) / prevSum) * 100;
    delta = { texto: `${pct >= 0 ? '+' : ''}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`, up: pct >= 0 };
  }

  return (
    <div className={cn('h-full rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm', className)}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-info">
        <Receipt className="h-4 w-4 shrink-0" /> Faturamento bruto
        <KpiInfoButton infoKey="Faturamento bruto da carteira" />
      </div>
      <div className="text-3xl font-bold tabular-nums">
        {totals?.gross_cents != null ? fmtBRL(totals.gross_cents / 100) : '—'}
      </div>
      {delta && (
        <div className={cn('mt-0.5 flex items-center gap-1 text-xs', delta.up ? 'text-success' : 'text-destructive')}>
          {delta.up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {delta.texto}
          <span className="text-muted-foreground">vs. mesmo período do mês anterior</span>
        </div>
      )}
      {/* Sem totais (erro), o `?? 0` afirmava "0 organizações" dentro do hero — o mesmo defeito da
          contagem acima da tabela, num lugar de mais destaque. Sem dado, a linha não aparece. */}
      {totals && (
        <div className="mt-1 text-xs text-muted-foreground">
          {fmtInt(totals.org_count)} organizações · {totals.orders != null ? fmtInt(totals.orders) : '—'} pedidos
        </div>
      )}
    </div>
  );
}

type ItemAtencao = {
  chave: string;
  mensagem: string;
  acao?: { rotulo: string; ariaLabel?: string; to?: string; onClick?: () => void };
};

export default function Organizacoes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const startSupport = useSupportStore((state) => state.start);
  const month = searchParams.get('mes') ?? currentMonth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [sort, setSort] = useState<'name' | 'slug' | 'gross_desc'>('gross_desc');
  const [page, setPage] = useState(1);
  const [somentePendencias, setSomentePendencias] = useState(false);
  const [novaOpen, setNovaOpen] = useState(false);
  const [supportOrg, setSupportOrg] = useState<OrgSummary | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);

  // Debounce: só copia searchInput para search (o que entra na queryKey) 300ms após a última tecla,
  // senão cada tecla refaz o ciclo inteiro no servidor.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const wallet = usePlatformWallet({
    month,
    search: search.trim() || undefined,
    include_test: includeTest,
    sort,
    page,
    page_size: PAGE_SIZE,
  });
  const totals = wallet.data?.totals;
  const orgs = useMemo(
    () => (wallet.data?.rows ?? []).filter((org) => includeTest || !org.is_test),
    [wallet.data, includeTest],
  );
  const orgsVisiveis = useMemo(
    () => somentePendencias ? orgs.filter((o) => (o.pending_count ?? 0) > 0 || o.modality == null) : orgs,
    [orgs, somentePendencias],
  );
  const sortLabel = sort === 'gross_desc' ? 'faturamento' : sort === 'slug' ? 'slug' : 'nome';

  const support = useQuery<SupportRequest[]>({
    queryKey: ['support-requests'],
    queryFn: async () => {
      const requests: SupportRequest[] = [];
      let p = 1;
      for (;;) {
        const result = await listSupportRequests({ page: p, pageSize: 50, status: 'actionable' });
        requests.push(...result.requests);
        if (requests.length >= result.total || result.requests.length === 0) break;
        p += 1;
      }
      return requests;
    },
  });
  const supportByOrg = useMemo(() => (support.data ?? []).reduce<Map<string, SupportRequest>>((requests, request) => {
    if (!requests.has(request.org_id)) requests.set(request.org_id, request);
    return requests;
  }, new Map()), [support.data]);

  const enterOperation = useCallback(async (request: SupportRequest) => {
    try {
      await startSupport(request.id);
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível iniciar o suporte.');
      await qc.invalidateQueries({ queryKey: ['support-requests'] });
    }
  }, [startSupport, navigate, qc]);

  async function cancelRequest(request: SupportRequest) {
    setCancellingRequestId(request.id);
    try {
      await cancelSupport(request.id);
      toast.success('Solicitação cancelada.');
      await qc.invalidateQueries({ queryKey: ['support-requests'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setCancellingRequestId(null);
    }
  }

  // Achados da T3 (2026-09-07): warnings da carteira (ex.: prévia/métricas indisponíveis para
  // parte da carteira) precisam de um lugar visível — senão "a prévia falhou" fica idêntico a "org
  // sem contrato". Entram na mesma faixa das pendências acionáveis, só sem botão de ação.
  const itensAtencao = useMemo<ItemAtencao[]>(() => {
    const itens: ItemAtencao[] = [];
    for (const org of orgs) {
      if (org.modality == null) {
        itens.push({
          chave: `terms-${org.id}`,
          mensagem: `${org.nome} sem condições comerciais`,
          acao: {
            rotulo: 'Cadastrar', ariaLabel: `Cadastrar condições comerciais — ${org.nome}`,
            to: `/admin/organizacoes/${org.id}?mes=${month}&aba=cobranca`,
          },
        });
      } else if ((org.pending_count ?? 0) > 0) {
        const n = org.pending_count!;
        itens.push({
          chave: `pending-${org.id}`,
          mensagem: `${org.nome}: ${n} ${n === 1 ? 'pendência' : 'pendências'} de cobrança`,
          acao: {
            rotulo: 'Ver', ariaLabel: `Ver pendências de cobrança — ${org.nome}`,
            to: `/admin/organizacoes/${org.id}?mes=${month}&aba=cobranca`,
          },
        });
      }
      const request = supportByOrg.get(org.id);
      const { canStart } = supportFlags(request);
      if (canStart && request) {
        itens.push({
          chave: `access-${org.id}`,
          mensagem: `Acesso a ${org.nome} aprovado — expira ${fmtHora(request.approval_expires_at!)}`,
          // aria-label distingue esta instância da mesma ação já visível na linha da tabela — dois
          // botões "Entrar na operação" com o mesmo nome acessível na página confundem leitor de tela.
          acao: { rotulo: 'Entrar na operação', ariaLabel: `Entrar na operação — ${org.nome}`, onClick: () => enterOperation(request) },
        });
      }
    }
    for (const warning of totals?.warnings ?? []) {
      itens.push({ chave: `warning-${warning}`, mensagem: warning });
    }
    return itens;
  }, [orgs, totals?.warnings, month, supportByOrg, enterOperation]);

  // Só nome/faturamento acompanham o servidor (T6: sort só aceita 'name'|'slug'|'gross_desc');
  // as demais colunas ordenam a página localmente e não mexem no `sort` do servidor.
  function onSortChange(key: string) {
    if (key === 'nome') { setSort('name'); setPage(1); } else if (key === 'gross') { setSort('gross_desc'); setPage(1); }
  }

  const colunas: Column<OrgSummary>[] = [
    {
      key: 'nome', header: 'Organização', className: 'min-w-[14rem]',
      sortValue: (o) => o.nome,
      cell: (o) => {
        const request = supportByOrg.get(o.id);
        return (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                to={`/admin/organizacoes/${o.id}?mes=${month}`}
                className="font-medium hover:underline"
                aria-label={`Ver organização ${o.nome}`}
                onClick={(e) => e.stopPropagation()}
              >
                {o.nome}
              </Link>
              {o.is_test && <Badge variant="outline">Teste</Badge>}
              {request?.status === 'active' && <StatusPill tone="info">Acesso ativo</StatusPill>}
              {request?.status === 'pending' && <StatusPill tone="neutral">Aguardando aprovação</StatusPill>}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{o.slug}</span>
              {o.modality != null ? <span>· Modalidade {o.modality}</span> : <StatusPill tone="warning">Sem condições</StatusPill>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'gross', header: 'Faturamento', className: 'w-[9.5rem] text-right tabular-nums',
      sortValue: (o) => o.metrics?.gross_cents ?? null,
      cell: (o) => {
        if (!o.metrics) return <span title="Métricas indisponíveis">—</span>;
        const prev = o.metrics.previous;
        const pct = prev && prev.gross_cents > 0
          ? ((o.metrics.gross_cents - prev.gross_cents) / prev.gross_cents) * 100
          : null;
        return (
          <div>
            <div className="font-semibold">{fmtBRL(o.metrics.gross_cents / 100)}</div>
            {pct != null && (
              <div className={cn('flex items-center justify-end gap-0.5 text-xs', pct >= 0 ? 'text-success' : 'text-destructive')}>
                {pct >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {pct >= 0 ? '+' : ''}{pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'markup', header: 'Markup', className: 'w-[6rem] text-right tabular-nums hidden md:table-cell',
      cell: (o) => {
        const m = o.metrics?.markup;
        if (m == null) return <span title="Sem custo ou alíquota confirmada">—</span>;
        return <span className={m >= 0 ? 'text-success' : 'text-destructive'}>{fmtMarkup(m)}</span>;
      },
    },
    {
      key: 'coverage', header: 'Cobertura', className: 'w-[7rem] text-right tabular-nums hidden lg:table-cell',
      cell: (o) => {
        if (!o.metrics) return <span title="Métricas indisponíveis">—</span>;
        const { cost_covered_orders, total_orders } = o.metrics;
        if (total_orders === 0) return <span title="Sem pedidos no mês">—</span>;
        const pct = Math.round((cost_covered_orders / total_orders) * 100);
        return (
          <div>
            <span className={pct < 70 ? 'text-destructive' : pct < 95 ? 'text-warning' : undefined}>{pct}%</span>
            <div className="text-xs text-muted-foreground">{total_orders} ped.</div>
          </div>
        );
      },
    },
    {
      // "Sonar", não "Pulse": é o termo que a Cobrança e o demonstrativo exportado usam para a
      // mesma métrica, e o cliente lê esse nome na fatura.
      key: 'pulse', header: 'Consultas Sonar', className: 'w-[7rem] text-right tabular-nums hidden lg:table-cell',
      cell: (o) => o.billable_units == null
        ? '—'
        : <span className={o.billable_units === 0 ? 'text-muted-foreground' : undefined}>{fmtInt(o.billable_units)}</span>,
    },
    {
      key: 'forecast', header: 'Previsão', className: 'w-[8.5rem] text-right tabular-nums',
      cell: (o) => {
        if (o.forecast_cents == null) {
          const title = o.modality == null ? 'Sem condições comerciais' : 'Bloqueada por pendências';
          return <span title={title}>—</span>;
        }
        return <span className="font-medium">{fmtBRL(o.forecast_cents / 100)}</span>;
      },
    },
    {
      key: 'pending', header: 'Pendências', className: 'w-[6rem] text-right',
      cell: (o) => {
        if (o.pending_count == null) return <span title="Prévia indisponível">—</span>;
        if (o.pending_count === 0) return '—';
        return <StatusPill tone="warning">{o.pending_count}</StatusPill>;
      },
    },
    {
      key: 'acoes', header: <span className="sr-only">Ações</span>, className: 'w-[3rem]', stickyRight: true,
      cell: (o) => {
        const request = supportByOrg.get(o.id);
        const { canStart, canRenew, canRequest } = supportFlags(request);
        // Sem wrapper com onClick (jsx-a11y proíbe handler de clique em <div> não-interativa): cada
        // elemento clicável para a própria propagação, mesmo padrão de Publicados.tsx.
        return (
          <div className="flex items-center justify-end gap-1.5">
            {canStart && <Button size="sm" onClick={(e) => { e.stopPropagation(); enterOperation(request!); }}>Entrar na operação</Button>}
            {!canStart && canRenew && <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSupportOrg(o); }}>Solicitar renovação</Button>}
            {request?.status === 'pending' && (
              <Button variant="ghost" size="sm" disabled={cancellingRequestId === request.id} onClick={(e) => { e.stopPropagation(); cancelRequest(request); }}>
                {cancellingRequestId === request.id ? 'Cancelando…' : 'Cancelar solicitação'}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Ações" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem asChild>
                  <Link to={`/admin/organizacoes/${o.id}?mes=${month}`}>Ver organização</Link>
                </DropdownMenuItem>
                {canRequest && (
                  <DropdownMenuItem onSelect={() => setSupportOrg(o)}>Solicitar acesso</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={`/admin/organizacoes/${o.id}?mes=${month}&aba=configuracoes`}>Configurações</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <PageHeader
        title="Organizações"
        subtitle="Carteira financeira e operacional da plataforma."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm" htmlFor="wallet-month">
              <span>Mês</span>
              <Input
                id="wallet-month"
                type="month"
                aria-label="Mês da carteira"
                value={month}
                onChange={(event) => setSearchParams((previous) => {
                  const next = new URLSearchParams(previous);
                  next.set('mes', event.target.value);
                  return next;
                })}
              />
            </label>
            <Button onClick={() => setNovaOpen(true)}>Nova empresa</Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <HeroCarteira totals={totals} orgs={orgs} loading={wallet.isLoading} className="col-span-2 sm:col-span-3 lg:col-span-2" />
        <KpiCard
          label="Previsão de cobrança" icon={WalletIcon} infoKey="Previsão de cobrança"
          loading={wallet.isLoading}
          value={
            totals && totals.org_count > 0 && totals.orgs_without_terms >= totals.org_count
              ? <span title="Nenhuma organização tem condição comercial vigente — sem base para prever">—</span>
              : totals?.forecast_cents != null ? fmtBRL(totals.forecast_cents / 100) : '—'
          }
          hint={totals && totals.orgs_without_terms > 0 ? `${totals.orgs_without_terms} sem condições — fora do total` : undefined}
        />
        <KpiCard
          label="Pendências" icon={AlertTriangle} infoKey="Pendências da carteira"
          loading={wallet.isLoading}
          value={totals?.pending_count != null ? fmtInt(totals.pending_count) : '—'}
          tom={(totals?.pending_count ?? 0) > 0 ? 'warning' : undefined}
          valueClassName={(totals?.pending_count ?? 0) > 0 ? 'text-warning' : undefined}
          onClick={() => setSomentePendencias((v) => !v)}
          ativo={somentePendencias}
        />
        <KpiCard
          label="Organizações" icon={Building2} infoKey="Organizações da carteira" className="col-span-2 sm:col-span-1"
          loading={wallet.isLoading}
          value={fmtInt(totals?.org_count ?? 0)}
        />
      </div>

      {wallet.data && itensAtencao.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Precisa da sua atenção</h2>
          <div className="flex flex-col gap-2">
            {itensAtencao.map((item) => (
              <div key={item.chave} className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
                <span className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  {item.mensagem}
                </span>
                {item.acao && (
                  item.acao.to ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to={item.acao.to} aria-label={item.acao.ariaLabel}>
                        {item.acao.rotulo} <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  ) : (
                    <Button size="sm" aria-label={item.acao.ariaLabel} onClick={item.acao.onClick}>
                      {item.acao.rotulo}
                    </Button>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nome ou slug"
            aria-label="Buscar organizações"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <div role="group" aria-label="Filtrar organizações" className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
          <Button size="sm" className="h-7" variant={!somentePendencias ? 'secondary' : 'ghost'} aria-pressed={!somentePendencias} onClick={() => setSomentePendencias(false)}>
            Todas
          </Button>
          <Button size="sm" className="h-7" variant={somentePendencias ? 'secondary' : 'ghost'} aria-pressed={somentePendencias} onClick={() => setSomentePendencias(true)}>
            Com pendências
          </Button>
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm" htmlFor="include-test-organizations">
          <Checkbox
            id="include-test-organizations"
            checked={includeTest}
            onCheckedChange={(checked) => { setIncludeTest(checked === true); setPage(1); }}
          />
          Incluir testes
        </label>
      </div>
      {/* Só com dado: `?? 0` afirmava "0 organizações" enquanto carregava e, pior, logo acima da
          faixa de erro — número falso onde o resto da tela usa skeleton. */}
      {wallet.data && (
        <p className="mb-2 text-xs text-muted-foreground">
          {wallet.data.total} organizações · ordenadas por {sortLabel}
        </p>
      )}

      {wallet.isError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          Não foi possível carregar a carteira.{' '}
          <Button variant="outline" size="sm" onClick={() => wallet.refetch()}>Tentar novamente</Button>
        </div>
      )}

      <DataTable<OrgSummary>
        className="bg-card"
        columns={colunas}
        rows={orgsVisiveis}
        rowKey={(o) => o.id}
        loading={wallet.isLoading}
        skeletonRows={3}
        onRowClick={(o) => navigate(`/admin/organizacoes/${o.id}?mes=${month}`)}
        defaultSort={{ key: 'gross', dir: 'desc' }}
        onSortChange={onSortChange}
        empty={
          // Em erro a faixa destrutiva acima já explica o vazio: repetir "nenhuma organização"
          // faria a falha parecer ausência de dado, que é a confusão que esta tela veio corrigir.
          wallet.isError ? null : search.trim() ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma organização para “{search.trim()}”
            </div>
          ) : (
            <EmptyState icon={Building2} title="Nenhuma organização encontrada" />
          )
        }
      />

      {wallet.data && wallet.data.total > PAGE_SIZE && (
        <Pagination
          paginaAtual={page}
          totalPaginas={Math.max(1, Math.ceil(wallet.data.total / PAGE_SIZE))}
          inicio={(page - 1) * PAGE_SIZE + 1}
          fim={Math.min(page * PAGE_SIZE, wallet.data.total)}
          total={wallet.data.total}
          tamanho={PAGE_SIZE}
          onIrPara={setPage}
          onTamanho={() => undefined}
          rotuloItem="organizações"
          tamanhos={[PAGE_SIZE]}
        />
      )}

      <NovaOrgDialog
        open={novaOpen}
        onOpenChange={setNovaOpen}
        onCreated={() => Promise.all([
          qc.invalidateQueries({ queryKey: ['organizacoes'] }),
          qc.invalidateQueries({ queryKey: ['platform-admin'] }),
        ])}
      />
      <SupportRequestDialog
        org={supportOrg}
        onClose={() => setSupportOrg(null)}
        onRequested={async () => {
          setSupportOrg(null);
          await qc.invalidateQueries({ queryKey: ['support-requests'] });
        }}
      />
      {support.isError && <p className="mt-2 text-sm text-destructive" role="alert">Não foi possível carregar o estado das solicitações.</p>}
    </div>
  );
}

function NovaOrgDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [marcaPadrao, setMarcaPadrao] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminNome, setAdminNome] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function criar() {
    setEnviando(true);
    try {
      await callUsuarios({
        action: 'create_org',
        nome,
        slug,
        marca_padrao: marcaPadrao,
        admin_email: adminEmail,
        admin_nome: adminNome,
      });
      toast.success('✓ Empresa criada');
      setNome(''); setSlug(''); setMarcaPadrao(''); setAdminEmail(''); setAdminNome('');
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar empresa');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input placeholder="Nome da empresa" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Input placeholder="Slug (ex.: minha-empresa)" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <Input placeholder="Marca padrão (ex.: MinhaMarca)" value={marcaPadrao} onChange={(e) => setMarcaPadrao(e.target.value)} />
          <Input type="email" placeholder="E-mail do primeiro admin" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          <Input placeholder="Nome do primeiro admin" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={!nome || !slug || !adminEmail || enviando}>
            {enviando ? 'Criando…' : 'Criar empresa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
