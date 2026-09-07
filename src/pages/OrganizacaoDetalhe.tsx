import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BarChart3, Radar, Receipt, ScrollText, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrgAudit } from '@/components/platform-admin/org-audit';
import { OrgBilling } from '@/components/platform-admin/org-billing';
import { OrgPulse } from '@/components/platform-admin/org-pulse';
import { OrgResults } from '@/components/platform-admin/org-results';
import { OrgSettings } from '@/components/platform-admin/org-settings';
import { SupportRequestDialog } from '@/components/platform-admin/support-request-dialog';
import { usePlatformOrganization, usePlatformPreview } from '@/hooks/usePlatformAdmin';
import { cancelSupport, listSupportRequests } from '@/lib/suporte';
import { useSupportStore } from '@/stores/support-store';

const tabs = ['resultados', 'pulse', 'cobranca', 'auditoria', 'configuracoes'] as const;
type Tab = typeof tabs[number];

function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function isTab(value: string | null): value is Tab {
  return tabs.includes(value as Tab);
}

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Mesma conta de `humanPercent` em `org-billing.tsx` — não exportada de lá (aba de outro agente).
function humanPercent(bps: number | null | undefined): string {
  if (bps == null) return 'Não definido';
  return `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

export default function OrganizacaoDetalhe() {
  const { orgId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get('mes') ?? currentMonth();
  const requestedTab = searchParams.get('aba');
  const tab: Tab = isTab(requestedTab) ? requestedTab : 'resultados';
  const organization = usePlatformOrganization(orgId, month);
  const org = organization.data;
  const preview = usePlatformPreview(orgId, month);
  const startSupport = useSupportStore((state) => state.start);
  const endSupport = useSupportStore((state) => state.end);

  const support = useQuery({
    queryKey: ['support-requests', orgId],
    queryFn: () => listSupportRequests({ orgId, page: 1, pageSize: 50, status: 'actionable' }),
    enabled: Boolean(orgId),
  });
  const request = support.data?.requests[0] ?? null;
  const canStart = request?.status === 'approved'
    && Boolean(request.approval_expires_at)
    && new Date(request.approval_expires_at!).getTime() > Date.now();
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);

  function updateSearch(key: 'mes' | 'aba', value: string) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      return next;
    });
  }

  async function refreshSupport() {
    await queryClient.invalidateQueries({ queryKey: ['support-requests', orgId] });
  }

  async function cancelRequest() {
    if (!request) return;
    setSupportBusy(true);
    try {
      await cancelSupport(request.id);
      toast.success('Solicitação cancelada.');
      await refreshSupport();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setSupportBusy(false);
    }
  }

  async function endActiveSupport() {
    if (!request) return;
    setSupportBusy(true);
    try {
      await endSupport(request.id);
      toast.success('Sessão de suporte encerrada.');
      await refreshSupport();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Não foi possível encerrar a sessão de suporte.');
    } finally {
      setSupportBusy(false);
    }
  }

  async function enterOperation() {
    if (!request) return;
    setSupportBusy(true);
    try {
      await startSupport(request.id);
      navigate('/');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Não foi possível iniciar o suporte.');
      await refreshSupport();
    } finally {
      setSupportBusy(false);
    }
  }

  // Contagem desconhecida (falha) não é 0: some do badge em vez de mentir "sem bloqueios".
  const blockerCount = preview.isError ? null : preview.data?.blockers.length ?? 0;

  const monthField = (
    <label className="flex items-center gap-2 text-sm" htmlFor="organization-month">
      <span className="font-medium">Mês</span>
      <Input id="organization-month" type="month" aria-label="Mês da organização" value={month} onChange={(event) => updateSearch('mes', event.target.value)} />
    </label>
  );

  const supportButton = request?.status === 'active' ? (
    <Button variant="outline" onClick={endActiveSupport} disabled={supportBusy}>
      {supportBusy ? 'Encerrando…' : 'Encerrar suporte'}
    </Button>
  ) : request?.status === 'pending' ? (
    <Button variant="outline" onClick={cancelRequest} disabled={supportBusy}>
      {supportBusy ? 'Cancelando…' : 'Cancelar solicitação'}
    </Button>
  ) : canStart ? (
    <Button onClick={enterOperation} disabled={supportBusy}>Entrar na operação</Button>
  ) : !request || !['pending', 'active'].includes(request.status) ? (
    <Button variant="outline" onClick={() => setSupportOpen(true)} disabled={supportBusy}>Solicitar acesso</Button>
  ) : null;

  let subtitleNode = null;
  if (org) {
    if (preview.isLoading) {
      subtitleNode = <Skeleton className="h-4 w-56" />;
    } else if (preview.isError) {
      subtitleNode = (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>Não foi possível carregar as condições comerciais.</span>
          <Button variant="outline" size="sm" onClick={() => preview.refetch()}>Tentar novamente</Button>
        </div>
      );
    } else if (preview.data?.terms) {
      const terms = preview.data.terms;
      subtitleNode = (
        <p className="text-sm text-muted-foreground">
          {org.slug} · Modalidade {terms.modality} · {humanPercent(terms.revenue_bps)} sobre receita
        </p>
      );
    } else if (org.next_terms_starts_on) {
      // ADR-0155: contrato já cadastrado, vigência só no mês seguinte. Informativo, não acionável —
      // o dono não tem nada a fazer aqui, então não há botão "Cadastrar".
      subtitleNode = (
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="info">Condição comercial começa em {org.next_terms_starts_on.slice(0, 7)}</StatusPill>
        </div>
      );
    } else {
      const cobrancaParams = new URLSearchParams(searchParams);
      cobrancaParams.set('aba', 'cobranca');
      subtitleNode = (
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="warning">Sem condições comerciais</StatusPill>
          <Link to={`?${cobrancaParams.toString()}`} className="text-sm font-medium text-primary hover:underline">
            Cadastrar em Cobrança
          </Link>
        </div>
      );
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link to={`/admin?mes=${month}`}><ArrowLeft />Voltar para organizações</Link>
      </Button>

      {organization.isLoading ? (
        <div className="mb-6 border-b pb-4">
          <Skeleton className="h-8 w-64" />
        </div>
      ) : organization.isError || !org ? (
        <div className="mb-6 border-b pb-4">
          <PageHeader title="Organização indisponível" />
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <span>Não foi possível carregar os dados da organização.</span>
            <Button variant="outline" size="sm" onClick={() => organization.refetch()}>Tentar novamente</Button>
          </div>
        </div>
      ) : (
        <div className="mb-6 border-b pb-4">
          <PageHeader
            className="mb-2"
            title={org.nome}
            actions={<>{monthField}{supportButton}</>}
          />
          <div className="flex flex-wrap items-center gap-2">
            {org.is_test && <Badge variant="outline">Ambiente de teste</Badge>}
            {request?.status === 'active' && (
              <StatusPill tone="info" title={request.expires_at ? `Expira às ${fmtHora(request.expires_at)}` : undefined}>
                Acesso ativo{request.expires_at ? ` · expira às ${fmtHora(request.expires_at)}` : ''}
              </StatusPill>
            )}
            {subtitleNode}
          </div>
        </div>
      )}

      <SupportRequestDialog
        org={org && supportOpen ? { id: org.id, nome: org.nome } : null}
        onClose={() => setSupportOpen(false)}
        onRequested={async () => {
          setSupportOpen(false);
          await refreshSupport();
        }}
      />

      <Tabs value={tab} onValueChange={(value) => updateSearch('aba', value)}>
        <TabsList aria-label="Seções da organização">
          <TabsTrigger value="resultados"><BarChart3 className="h-4 w-4" />Resultados</TabsTrigger>
          <TabsTrigger value="pulse"><Radar className="h-4 w-4" />Pulse</TabsTrigger>
          <TabsTrigger value="cobranca">
            <Receipt className="h-4 w-4" />Cobrança
            {blockerCount !== null && blockerCount > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                {blockerCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="auditoria"><ScrollText className="h-4 w-4" />Auditoria</TabsTrigger>
          <TabsTrigger value="configuracoes"><Settings2 className="h-4 w-4" />Configurações</TabsTrigger>
        </TabsList>
        <TabsContent value="resultados" className="pt-4"><OrgResults orgId={orgId} month={month} /></TabsContent>
        <TabsContent value="pulse" className="pt-4"><OrgPulse orgId={orgId} month={month} /></TabsContent>
        <TabsContent value="cobranca" className="pt-4"><OrgBilling orgId={orgId} month={month} /></TabsContent>
        <TabsContent value="auditoria" className="pt-4"><OrgAudit orgId={orgId} month={month} /></TabsContent>
        <TabsContent value="configuracoes" className="pt-4"><OrgSettings orgId={orgId} /></TabsContent>
      </Tabs>
    </div>
  );
}
