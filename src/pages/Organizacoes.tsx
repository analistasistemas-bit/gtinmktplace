import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { usePlatformOrganizations, usePlatformOverview } from '@/hooks/usePlatformAdmin';
import type { OrgSummary } from '@/lib/platform-admin';
import { fmtBRL } from '@/lib/formato';
import { LISTA_CANAIS } from '@/lib/canais';
import { MODULOS } from '@/lib/modulos';
import { cancelSupport, listSupportRequests, requestSupport, type SupportRequest, type SupportScope } from '@/lib/suporte';
import { useSupportStore } from '@/stores/support-store';

interface OrgRow extends OrgSummary {
  canais_habilitados: string[];
  modulos_habilitados: string[];
  tipo_pessoa: 'pf' | 'pj' | null;
}

const PAGE_SIZE = 10;

function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

const unavailable = 'Indisponível';
const money = (cents: number | null | undefined) => cents == null ? unavailable : fmtBRL(cents / 100);
const number = (value: number | null | undefined) => value == null ? unavailable : value.toLocaleString('pt-BR');

function coverage(org: OrgSummary) {
  const metrics = org.metrics;
  if (!metrics || metrics.total_orders === 0) return unavailable;
  return `${metrics.cost_covered_orders}/${metrics.total_orders} (${Math.round((metrics.cost_covered_orders / metrics.total_orders) * 100)}%)`;
}

function evolution(org: OrgSummary) {
  const metrics = org.metrics;
  if (!metrics?.previous || metrics.previous.gross_cents === 0) return unavailable;
  const change = ((metrics.gross_cents - metrics.previous.gross_cents) / metrics.previous.gross_cents) * 100;
  return `${change >= 0 ? '+' : ''}${change.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

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

export default function Organizacoes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const startSupport = useSupportStore((state) => state.start);
  const month = searchParams.get('mes') ?? currentMonth();
  const [search, setSearch] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [sort, setSort] = useState<'name' | 'slug' | 'gross_desc'>('name');
  const [page, setPage] = useState(1);
  const [novaOpen, setNovaOpen] = useState(false);
  const [delOrg, setDelOrg] = useState<OrgRow | null>(null);
  const [canaisOrg, setCanaisOrg] = useState<OrgRow | null>(null);
  const [modulosOrg, setModulosOrg] = useState<OrgRow | null>(null);
  const [supportOrg, setSupportOrg] = useState<OrgRow | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);

  const overview = usePlatformOverview(month, includeTest);
  const organizations = usePlatformOrganizations({
    month,
    search: search.trim() || undefined,
    include_test: includeTest,
    sort,
    page,
    page_size: PAGE_SIZE,
  });
  const orgs = (organizations.data?.rows ?? []).filter((org) => includeTest || !org.is_test) as OrgRow[];
  const totalPages = Math.max(1, Math.ceil((organizations.data?.total ?? 0) / PAGE_SIZE));

  const support = useQuery<SupportRequest[]>({
    queryKey: ['support-requests'],
    queryFn: async () => {
      const requests: SupportRequest[] = [];
      let page = 1;
      for (;;) {
        const result = await listSupportRequests({ page, pageSize: 50, status: 'actionable' });
        requests.push(...result.requests);
        if (requests.length >= result.total || result.requests.length === 0) break;
        page += 1;
      }
      return requests;
    },
  });
  const supportByOrg = (support.data ?? []).reduce<Map<string, SupportRequest>>((requests, request) => {
    if (!requests.has(request.org_id)) requests.set(request.org_id, request);
    return requests;
  }, new Map());

  async function enterOperation(request: SupportRequest) {
    try {
      await startSupport(request.id);
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível iniciar o suporte.');
      await qc.invalidateQueries({ queryKey: ['support-requests'] });
    }
  }

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

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <PageHeader
        title="Organizações"
        subtitle="Carteira financeira e operacional da plataforma."
        actions={<Button onClick={() => setNovaOpen(true)}>Nova empresa</Button>}
      />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Faturamento bruto', money(overview.data?.gross_cents)],
          ['Previsão', money(overview.data?.forecast_cents)],
          ['Organizações', overview.data ? number(overview.data.org_count) : unavailable],
          ['Pendências', number(overview.data?.pending_count)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{overview.isLoading ? 'Carregando…' : value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {overview.data?.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-sm text-muted-foreground">{warning}</p>
      ))}

      <Card className="mt-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_auto_auto_auto]">
          <Input
            aria-label="Buscar organizações"
            placeholder="Buscar por nome ou slug"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
          <label className="flex items-center gap-2 text-sm" htmlFor="include-test-organizations">
            <Checkbox
              id="include-test-organizations"
              checked={includeTest}
              onCheckedChange={(checked) => { setIncludeTest(checked === true); setPage(1); }}
            />
            Incluir testes
          </label>
          <select
            aria-label="Ordenar organizações"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={sort}
            onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }}
          >
            <option value="name">Nome</option>
            <option value="slug">Slug</option>
            <option value="gross_desc">Maior faturamento</option>
          </select>
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
        </CardContent>
      </Card>

      {(overview.isError || organizations.isError) && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          Não foi possível carregar a carteira. Tente novamente.
        </p>
      )}

      <div className="mt-4 space-y-3" aria-label="Carteira de organizações">
        <div className="hidden grid-cols-[minmax(12rem,1.5fr)_repeat(8,minmax(5rem,1fr))_auto] gap-3 px-4 text-xs font-medium text-muted-foreground lg:grid">
          <span>Organização</span><span>Modalidade</span><span>Faturamento</span><span>Evolução</span>
          <span>Markup</span><span>Cobertura</span><span>Pulse</span><span>Previsão</span><span>Pendências</span><span>Ações</span>
        </div>
        {organizations.isLoading ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">Carregando organizações…</CardContent></Card>
        ) : orgs.length === 0 && !organizations.isError ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">Nenhuma organização encontrada.</CardContent></Card>
        ) : orgs.map((org) => (
          <OrganizationRow
            key={org.id}
            org={org}
            month={month}
            request={supportByOrg.get(org.id)}
            cancellingRequestId={cancellingRequestId}
            onCancel={cancelRequest}
            onEnter={enterOperation}
            onSupport={setSupportOrg}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Página {page} de {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
        </div>
      </div>

      <NovaOrgDialog
        open={novaOpen}
        onOpenChange={setNovaOpen}
        onCreated={() => Promise.all([
          qc.invalidateQueries({ queryKey: ['organizacoes'] }),
          qc.invalidateQueries({ queryKey: ['platform-admin'] }),
        ])}
      />
      <ExcluirOrgDialog
        org={delOrg}
        onClose={() => setDelOrg(null)}
        onDeleted={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
      />
      <CanaisOrgDialog
        org={canaisOrg}
        onClose={() => setCanaisOrg(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
      />
      <ModulosOrgDialog
        org={modulosOrg}
        onClose={() => setModulosOrg(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
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

function OrganizationRow({ org, month, request, cancellingRequestId, onCancel, onEnter, onSupport }: {
  org: OrgRow;
  month: string;
  request?: SupportRequest;
  cancellingRequestId: string | null;
  onCancel: (request: SupportRequest) => Promise<void>;
  onEnter: (request: SupportRequest) => Promise<void>;
  onSupport: (org: OrgRow) => void;
}) {
  const canStart = request?.status === 'approved'
    && Boolean(request.approval_expires_at)
    && new Date(request.approval_expires_at!).getTime() > Date.now();
  const canRenew = request?.status === 'active'
    && Boolean(request.expires_at)
    && new Date(request.expires_at!).getTime() > Date.now()
    && new Date(request.expires_at!).getTime() - Date.now() <= 15 * 60_000;
  const actions = (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
      {request && <span className="text-xs text-muted-foreground">{supportStatus(request.status)} · {scopeLabel(request.scope)}</span>}
      {request?.status === 'pending' && (
        <Button variant="ghost" size="sm" disabled={cancellingRequestId === request.id} onClick={() => onCancel(request)}>
          {cancellingRequestId === request.id ? 'Cancelando…' : 'Cancelar solicitação'}
        </Button>
      )}
      {canStart ? (
        <Button size="sm" onClick={() => onEnter(request)}>Entrar na operação</Button>
      ) : canRenew ? (
        <Button variant="outline" size="sm" onClick={() => onSupport(org)}>Solicitar renovação</Button>
      ) : !request || !['pending', 'active'].includes(request.status) ? (
        <Button variant="outline" size="sm" onClick={() => onSupport(org)}>Solicitar acesso</Button>
      ) : null}
      <Button asChild variant="ghost" size="sm">
        <Link to={`/admin/organizacoes/${org.id}?mes=${month}`}>Ver organização {org.nome}</Link>
      </Button>
    </div>
  );

  const metricValues = [
    ['Modalidade', org.modality == null ? unavailable : `Modalidade ${org.modality}`],
    ['Faturamento', money(org.metrics?.gross_cents)],
    ['Evolução', evolution(org)],
    ['Markup da organização', org.metrics?.markup == null ? unavailable : `${org.metrics.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`],
    ['Cobertura', coverage(org)],
    ['Pulse', number(org.billable_units)],
    ['Previsão', money(org.forecast_cents)],
    ['Pendências da organização', number(org.pending_count)],
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(12rem,1.5fr)_repeat(8,minmax(5rem,1fr))_auto] lg:items-center lg:gap-3">
          <div>
            <div className="flex items-center gap-2 font-medium">{org.nome}{org.is_test && <Badge variant="outline">Teste</Badge>}</div>
            <p className="text-xs text-muted-foreground">{org.slug}</p>
          </div>
          {metricValues.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 text-sm lg:block">
              <span className="text-muted-foreground lg:sr-only">{label}</span>
              <span className="tabular-nums">{value}</span>
            </div>
          ))}
          <div className="pt-2 lg:pt-0">{actions}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const supportStatus = (status: SupportRequest['status']) => ({
  pending: 'Aguardando aprovação', approved: 'Aprovada', active: 'Acesso ativo', rejected: 'Rejeitada',
  cancelled: 'Cancelada', expired: 'Expirada', revoked: 'Revogada', ended: 'Encerrada',
})[status];

const scopeLabel = (scope: SupportScope) => scope === 'read' ? 'Somente leitura' : 'Acesso total';

function SupportRequestDialog({ org, onClose, onRequested }: {
  org: OrgRow | null;
  onClose: () => void;
  onRequested: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<SupportScope>('read');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setReason(''); setScope('read'); setError(null); }, [org?.id]);

  async function submit() {
    if (!org) return;
    if (!reason.trim()) {
      setError('Informe o motivo do acesso.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await requestSupport({ orgId: org.id, scope, reason: reason.trim() });
      toast.success('Solicitação enviada para os administradores da organização.');
      await onRequested();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Solicitar acesso a {org?.nome}</DialogTitle><DialogDescription>O acesso só começa após aprovação de um administrador da organização.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Escopo do acesso</p>
            <label className="flex items-center gap-2 text-sm" htmlFor="support-scope-read">
              <input id="support-scope-read" name="support-scope" type="radio" value="read" checked={scope === 'read'} onChange={() => setScope('read')} />
              Somente leitura
            </label>
            <label className="flex items-center gap-2 text-sm" htmlFor="support-scope-full">
              <input id="support-scope-full" name="support-scope" type="radio" value="full" checked={scope === 'full'} onChange={() => setScope('full')} />
              Acesso total
            </label>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="support-reason">Motivo do acesso</label>
            <textarea id="support-reason" className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive" role="alert" aria-live="polite">{error}</p>}
          <p className="text-xs text-muted-foreground">A solicitação expira em 24 horas. Após aprovada, ela deve ser iniciada em até 1 hora.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Enviando…' : 'Enviar solicitação'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirOrgDialog({ org, onClose, onDeleted }: {
  org: OrgRow | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmSlug, setConfirmSlug] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  useEffect(() => { setConfirmSlug(''); }, [org?.id]);

  async function excluir() {
    if (!org) return;
    setExcluindo(true);
    try {
      await callUsuarios({ action: 'delete_org', org_id: org.id });
      toast.success('✓ Empresa excluída');
      onClose();
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir empresa');
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Excluir {org?.nome}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Isto apaga <strong>todos os dados</strong> da empresa (lotes, anúncios, vendas, usuários)
            e <strong>não pode ser desfeito</strong>. Anúncios já publicados no marketplace <strong>não</strong> são
            removidos de lá — só os registros locais.
          </p>
          <p className="text-muted-foreground">
            Para confirmar, digite o slug <code className="rounded bg-muted px-1 text-foreground">{org?.slug}</code>:
          </p>
          <Input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} placeholder={org?.slug} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={excluindo}>Cancelar</Button>
          <Button variant="destructive" onClick={excluir} disabled={confirmSlug !== org?.slug || excluindo}>
            {excluindo ? 'Excluindo…' : 'Excluir empresa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// E6b (D-13): módulos pagos por org. Espelha CanaisOrgDialog, com uma diferença
// proposital — não existe módulo obrigatório, lista vazia é o default de toda org.
function ModulosOrgDialog({ org, onClose, onSaved }: {
  org: OrgRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [modulos, setModulos] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (org) setModulos(new Set(org.modulos_habilitados ?? []));
  }, [org]);

  async function salvar() {
    if (!org) return;
    setSalvando(true);
    try {
      await callUsuarios({ action: 'set_modulos_org', org_id: org.id, modulos: [...modulos] });
      toast.success('✓ Módulos atualizados');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar módulos');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Módulos de {org?.nome}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Módulos pagos desta empresa. Desligar esconde o menu e faz as edges do módulo
          recusarem chamadas dessa empresa — o dado já gravado não é apagado.
        </p>
        <div className="flex flex-col gap-2">
          {MODULOS.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={modulos.has(m.id)}
                onCheckedChange={(v) => setModulos((prev) => {
                  const novo = new Set(prev);
                  if (v === true) novo.add(m.id); else novo.delete(m.id);
                  return novo;
                })}
              />
              <span>
                {m.nome}
                <span className="block text-xs text-muted-foreground">{m.descricao}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CanaisOrgDialog({ org, onClose, onSaved }: {
  org: OrgRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [canais, setCanais] = useState<Set<string>>(new Set(['mercado_livre']));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (org) setCanais(new Set(org.canais_habilitados ?? ['mercado_livre']));
  }, [org]);

  async function salvar() {
    if (!org) return;
    setSalvando(true);
    try {
      await callUsuarios({ action: 'set_canais_org', org_id: org.id, canais: [...canais] });
      toast.success('✓ Canais atualizados');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar canais');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Canais de {org?.nome}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Canais que esta empresa enxerga como conectáveis. Canal "em breve" no produto continua
          em breve mesmo habilitado aqui — isto controla o rollout quando o canal for lançado.
        </p>
        <div className="flex flex-col gap-2">
          {LISTA_CANAIS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={canais.has(c.id)}
                disabled={c.id === 'mercado_livre'}
                onCheckedChange={(v) => setCanais((prev) => {
                  const novo = new Set(prev);
                  if (v === true) novo.add(c.id); else novo.delete(c.id);
                  return novo;
                })}
              />
              {c.nome}
              {c.id === 'mercado_livre' && <span className="text-xs text-muted-foreground">(sempre ativo)</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
