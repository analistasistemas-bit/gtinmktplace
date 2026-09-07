import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrgAudit } from '@/components/platform-admin/org-audit';
import { OrgBilling } from '@/components/platform-admin/org-billing';
import { OrgPulse } from '@/components/platform-admin/org-pulse';
import { OrgResults } from '@/components/platform-admin/org-results';
import { OrgSettings } from '@/components/platform-admin/org-settings';
import { usePlatformOrganizations } from '@/hooks/usePlatformAdmin';

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

export default function OrganizacaoDetalhe() {
  const { orgId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get('mes') ?? currentMonth();
  const requestedTab = searchParams.get('aba');
  const tab: Tab = isTab(requestedTab) ? requestedTab : 'resultados';
  const organizations = usePlatformOrganizations({
    month,
    include_test: true,
    page: 1,
    page_size: 100,
    sort: 'name',
  });
  const org = organizations.data?.rows.find((item) => item.id === orgId);

  function updateSearch(key: 'mes' | 'aba', value: string) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link to={`/admin?mes=${month}`}><ArrowLeft />Voltar para organizações</Link>
      </Button>

      <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {organizations.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando organização…</p>
          ) : organizations.isError || !org ? (
            <h1 className="text-2xl font-semibold tracking-tight">Organização indisponível</h1>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{org.nome}</h1>
                {org.is_test && <Badge variant="outline">Ambiente de teste</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{org.slug}</p>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm" htmlFor="organization-month">
          <span className="font-medium">Mês</span>
          <Input id="organization-month" type="month" aria-label="Mês da organização" value={month} onChange={(event) => updateSearch('mes', event.target.value)} />
        </label>
      </div>

      {organizations.isError && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          Não foi possível carregar os dados da organização.
        </p>
      )}
      {organizations.isStale && organizations.data && (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status">
          O cadastro da organização pode estar desatualizado.
        </p>
      )}

      <Tabs value={tab} onValueChange={(value) => updateSearch('aba', value)} className="mt-4">
        <TabsList variant="line" aria-label="Seções da organização">
          <TabsTrigger value="resultados">Resultados</TabsTrigger>
          <TabsTrigger value="pulse">Pulse</TabsTrigger>
          <TabsTrigger value="cobranca">Cobrança</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
          <TabsTrigger value="configuracoes">Configurações</TabsTrigger>
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
