import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useProfile } from '@/hooks/useProfile';
import { supabase } from '@/lib/supabase';
import { decideSupport, listSupportRequests, revokeSupport, type SupportRequest, type SupportStatus } from '@/lib/suporte';

interface AuditEvent {
  id: string;
  support_request_id: string;
  actor_id: string | null;
  event: string;
  target_type: string | null;
  target_id: string | null;
  result: string;
  created_at: string;
}

type PendingAction = { request: SupportRequest; type: 'approved' | 'rejected' | 'revoke' } | null;

const statusLabel: Record<SupportStatus, string> = {
  pending: 'Pendente', approved: 'Aprovada', active: 'Ativo', rejected: 'Rejeitada',
  cancelled: 'Cancelada', expired: 'Expirada', revoked: 'Revogada', ended: 'Encerrada',
};

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

export default function SupportRequests() {
  const { isAdmin, profileLoading } = useProfile();
  const [pending, setPending] = useState<SupportRequest[]>([]);
  const [active, setActive] = useState<SupportRequest[]>([]);
  const [history, setHistory] = useState<SupportRequest[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditError, setAuditError] = useState<string | null>(null);
  const auditPageSize = 20;

  async function loadRequests() {
    setLoading(true);
    try {
      const [pendingPage, activePage, historyPageResult] = await Promise.all([
        listSupportRequests({ status: 'pending', pageSize: 50 }),
        listSupportRequests({ status: 'active', pageSize: 50 }),
        listSupportRequests({ status: 'history', page: historyPage, pageSize: 20 }),
      ]);
      setPending(pendingPage.requests);
      setActive(activePage.requests);
      setHistory(historyPageResult.requests);
      setHistoryTotal(historyPageResult.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as solicitações.');
    } finally {
      setLoading(false);
    }
  }

  // `loadRequests` é recriada a cada render; a dependência funcional é a página e a permissão.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isAdmin) void loadRequests(); }, [historyPage, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    async function loadAudit() {
      const auditClient = supabase as unknown as { from: (table: string) => {
        select: (columns: string, options: { count: 'exact' }) => {
          order: (column: string, options: { ascending: boolean }) => {
            range: (from: number, to: number) => Promise<{ data: AuditEvent[] | null; count: number | null; error: { message: string } | null }>;
          };
        };
      } };
      const result = await auditClient.from('support_audit_events')
        .select('id,support_request_id,actor_id,event,target_type,target_id,result,created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((auditPage - 1) * auditPageSize, auditPage * auditPageSize - 1);
      if (cancelled) return;
      if (result.error) {
        setAuditError(result.error.message);
        return;
      }
      setAudit(result.data ?? []);
      setAuditTotal(result.count ?? 0);
      setAuditError(null);
    }
    void loadAudit();
    return () => { cancelled = true; };
  }, [auditPage, isAdmin]);

  async function confirmAction() {
    if (!pendingAction) return;
    setSaving(true);
    try {
      if (pendingAction.type === 'revoke') await revokeSupport(pendingAction.request.id);
      else await decideSupport(pendingAction.request.id, pendingAction.type);
      setPendingAction(null);
      await loadRequests();
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      const message = status === 409
        ? 'Esta solicitação já foi decidida por outro administrador. A lista foi atualizada.'
        : caught instanceof Error ? caught.message : 'Não foi possível atualizar a solicitação.';
      setPendingAction(null);
      await loadRequests();
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (profileLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!isAdmin) {
    return <div className="mx-auto max-w-3xl p-4 lg:p-6"><EmptyState title="Acesso restrito" description="Somente administradores da organização podem consultar solicitações e histórico de suporte." /></div>;
  }

  const auditPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));
  const historyPages = Math.max(1, Math.ceil(historyTotal / 20));
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      <PageHeader title="Histórico de suporte" subtitle="Aprove, rejeite ou revogue acessos temporários à sua organização." />
      {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>}

      <Section title="Solicitações pendentes">
        {loading ? <p className="text-sm text-muted-foreground">Carregando solicitações…</p> : pending.length ? <RequestTable requests={pending} onAction={setPendingAction} /> : <EmptyState title="Nenhuma solicitação pendente" />}
      </Section>

      <Section title="Acessos ativos">
        {loading ? <p className="text-sm text-muted-foreground">Carregando acessos…</p> : active.length ? <RequestTable requests={active} onAction={setPendingAction} active /> : <EmptyState title="Nenhum acesso ativo" />}
      </Section>

      <Section title="Solicitações anteriores">
        {loading ? <p className="text-sm text-muted-foreground">Carregando histórico…</p> : history.length ? <>
          <RequestTable requests={history} onAction={setPendingAction} />
          <Pagination paginaAtual={historyPage} totalPaginas={historyPages} inicio={(historyPage - 1) * 20 + 1} fim={(historyPage - 1) * 20 + history.length} total={historyTotal} tamanho={20} onIrPara={setHistoryPage} onTamanho={() => undefined} rotuloItem="solicitação" tamanhos={[20]} />
        </> : <EmptyState title="Nenhuma solicitação anterior" />}
      </Section>

      <Section title="Eventos de auditoria">
        {auditError ? <p className="text-sm text-destructive" role="alert">Não foi possível carregar a auditoria: {auditError}</p> : audit.length ? <>
          <Table><TableHeader><TableRow><TableHead>Evento</TableHead><TableHead>Resultado</TableHead><TableHead>Alvo</TableHead><TableHead>Data</TableHead></TableRow></TableHeader><TableBody>
            {audit.map((event) => <TableRow key={event.id}><TableCell>{event.event}</TableCell><TableCell>{event.result}</TableCell><TableCell>{event.target_type && event.target_id ? `${event.target_type} · ${event.target_id}` : '—'}</TableCell><TableCell>{dateTime(event.created_at)}</TableCell></TableRow>)}
          </TableBody></Table>
          <div className="mt-3 flex items-center justify-between text-sm"><span className="text-muted-foreground">Página {auditPage} de {auditPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={auditPage === 1} onClick={() => setAuditPage((page) => page - 1)}>Anterior</Button><Button size="sm" variant="outline" disabled={auditPage >= auditPages} onClick={() => setAuditPage((page) => page + 1)}>Próxima</Button></div></div>
        </> : <EmptyState title="Nenhum evento de auditoria" />}
      </Section>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.type === 'approved' ? 'Aprovar solicitação?' : pendingAction?.type === 'rejected' ? 'Rejeitar solicitação?' : 'Revogar acesso?'}</AlertDialogTitle>
            <AlertDialogDescription>Esta decisão é registrada no histórico e passa a valer imediatamente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={confirmAction}>{pendingAction?.type === 'approved' ? 'Confirmar aprovação' : pendingAction?.type === 'rejected' ? 'Confirmar rejeição' : 'Confirmar revogação'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="mb-3 text-lg font-semibold">{title}</h2><Card className="overflow-hidden p-4">{children}</Card></section>;
}

function RequestTable({ requests, onAction, active = false }: { requests: SupportRequest[]; onAction: (action: PendingAction) => void; active?: boolean }) {
  return <Table><TableHeader><TableRow><TableHead>Solicitante</TableHead><TableHead>Escopo</TableHead><TableHead>Motivo</TableHead><TableHead>Status</TableHead><TableHead>Prazo</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>
    {requests.map((request) => <TableRow key={request.id}><TableCell>{request.requester_name ?? request.requester_email ?? request.requester_id}</TableCell><TableCell>{request.scope === 'read' ? 'Somente leitura' : 'Acesso total'}</TableCell><TableCell>{request.reason}</TableCell><TableCell><Badge variant="outline">{statusLabel[request.status]}</Badge></TableCell><TableCell>{dateTime(active ? request.expires_at : request.pending_expires_at)}</TableCell><TableCell className="text-right">
      {request.status === 'pending' && <><Button size="sm" onClick={() => onAction({ request, type: 'approved' })}>Aprovar</Button><Button size="sm" variant="outline" className="ml-2" onClick={() => onAction({ request, type: 'rejected' })}>Rejeitar</Button></>}
      {request.status === 'active' && <Button size="sm" variant="destructive" onClick={() => onAction({ request, type: 'revoke' })}>Revogar acesso</Button>}
    </TableCell></TableRow>)}
  </TableBody></Table>;
}
