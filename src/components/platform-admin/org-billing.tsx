import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, FileText } from 'lucide-react';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { CommercialTermsForm } from '@/components/platform-admin/commercial-terms-form';
import { RevenueReconciliation, type ReconciliationCandidate } from '@/components/platform-admin/revenue-reconciliation';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  useClosePlatformStatement,
  usePlatformPreview,
  usePlatformStatements,
  usePlatformTerms,
} from '@/hooks/usePlatformAdmin';
import { buildBillingReport } from '@/lib/export/platform-billing';
import { fmtBRL } from '@/lib/formato';
import { effectiveTerm, todayInFortaleza, type BillingLine, type BillingPreview, type PlatformAdminError } from '@/lib/platform-admin';

type Props = { orgId: string; month: string };

function currentFortalezaMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function amount(lines: BillingLine[], key: string): number {
  return lines.find((line) => line.key === key)?.amount_cents ?? 0;
}

function humanPercent(bps: number | null | undefined): string {
  if (bps == null) return '—';
  return `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function candidateFrom(preview: BillingPreview, index: number): ReconciliationCandidate | null {
  const blocker = preview.blockers[index];
  if (
    blocker?.code !== 'refund_reconciliation_required'
    || typeof blocker.sale_id !== 'string'
    || typeof blocker.source_updated_at !== 'string'
    || typeof blocker.gross_cents !== 'number'
  ) return null;
  return {
    sale_id: blocker.sale_id,
    order_ref: typeof blocker.order_ref === 'string' ? blocker.order_ref : null,
    source_updated_at: blocker.source_updated_at,
    gross_cents: blocker.gross_cents,
    status: typeof blocker.status === 'string' ? blocker.status : 'não informado',
  };
}

/** Estado da prévia como pill de uma linha, na mesma ordem de checagem de `canClose` — a primeira
 *  condição falsa é o motivo exibido (na pill e no `title` do botão desabilitado). */
function previewState(preview: BillingPreview, completedMonth: boolean): { tone: StatusTone; label: string } {
  if (!preview.terms) return { tone: 'warning', label: 'Sem condições comerciais' };
  if (preview.blockers.length > 0) {
    const n = preview.blockers.length;
    return { tone: 'warning', label: `Bloqueada · ${n} pendência${n === 1 ? '' : 's'}` };
  }
  if (!completedMonth) return { tone: 'info', label: 'Mês em aberto' };
  return { tone: 'success', label: 'Pronta para fechar' };
}

function Composition({ preview }: { preview: BillingPreview }) {
  const setup = amount(preview.lines, 'setup');
  const infrastructure = amount(preview.lines, 'infrastructure');
  const credits = amount(preview.lines, 'credits');
  const rows = [
    ['Receita bruta', preview.gross_cents],
    ['Ajustes da base', -preview.refund_cents || 0],
    [`Percentual (${humanPercent(preview.terms?.revenue_bps)})`, preview.fee_cents],
    ['Infraestrutura', infrastructure],
    [`Consultas Sonar (${preview.sonar_units})`, preview.sonar_cents],
    ['Implantação', setup],
    ['Créditos', credits || (-preview.credit_cents || 0)],
  ] as const;
  return (
    <dl className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular-nums">{fmtBRL(value / 100)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t pt-3 text-base font-semibold">
        <dt>{preview.total_cents < 0 ? 'Crédito a favor da organização' : 'Total a cobrar'}</dt>
        <dd className="tabular-nums">{fmtBRL(Math.abs(preview.total_cents) / 100)}</dd>
      </div>
    </dl>
  );
}

export function OrgBilling({ orgId, month }: Props) {
  const previewQuery = usePlatformPreview(orgId, month);
  const statementsQuery = usePlatformStatements(orgId);
  const termsQuery = usePlatformTerms(orgId);
  const close = useClosePlatformStatement();
  const [confirming, setConfirming] = useState(false);
  const [candidate, setCandidate] = useState<ReconciliationCandidate | null>(null);
  const completedMonth = useMemo(() => month < currentFortalezaMonth(), [month]);
  const today = useMemo(() => todayInFortaleza(), []);
  const preview = previewQuery.data;
  const canClose = Boolean(preview?.terms && preview.blockers.length === 0 && completedMonth);
  const current = useMemo(
    () => effectiveTerm(termsQuery.data?.rows ?? [], today),
    [termsQuery.data, today],
  );

  async function confirmClose() {
    if (!preview || !canClose) return;
    try {
      await close.mutateAsync({
        org_id: orgId,
        month,
        expected_revision: preview.revision,
      });
      setConfirming(false);
      toast.success('Demonstrativo fechado.');
    } catch (caught) {
      const error = caught as PlatformAdminError & { status?: number };
      if (error.code === 'conflict' || error.status === 409) {
        setConfirming(false);
        await previewQuery.refetch();
        toast.error('A prévia mudou. Revise os novos valores e confirme novamente.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Não foi possível fechar o demonstrativo.');
    }
  }

  if (previewQuery.isLoading || termsQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </div>
    );
  }

  if (previewQuery.isError || termsQuery.isError || !preview) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <span>Não foi possível carregar a cobrança.</span>
        <Button variant="outline" size="sm" onClick={() => { void previewQuery.refetch(); void termsQuery.refetch(); }}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const state = previewState(preview, completedMonth);

  return (
    <div className="space-y-4">
      <CommercialTermsForm
        orgId={orgId}
        current={current}
        onSaved={() => {
          void previewQuery.refetch();
          void termsQuery.refetch();
          toast.success('✓ Condições salvas');
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Prévia de cobrança · {month}</CardTitle>
          <CardDescription>
            <StatusPill tone={state.tone}>{state.label}</StatusPill>
          </CardDescription>
          <CardAction>
            <Button
              disabled={!canClose || close.isPending}
              title={canClose ? undefined : state.label}
              onClick={() => setConfirming(true)}
            >
              Fechar demonstrativo
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <Composition preview={preview} />
          {preview.blockers.length > 0 && (
            <div className="space-y-2" aria-label="Pendências da cobrança">
              {preview.blockers.map((blocker, index) => {
                const reconciliation = candidateFrom(preview, index);
                return (
                  <div key={`${blocker.code}-${blocker.sale_id ?? index}`} className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
                    <span className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <span>
                        {blocker.message}
                        {blocker.order_ref && (
                          <span className="block text-xs text-muted-foreground">Pedido {blocker.order_ref}</span>
                        )}
                      </span>
                    </span>
                    {reconciliation && (
                      <Button variant="outline" size="sm" onClick={() => setCandidate(reconciliation)}>
                        Conciliar devolução
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Demonstrativos fechados</CardTitle></CardHeader>
        <CardContent>
          {statementsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : statementsQuery.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <span>Não foi possível carregar os demonstrativos.</span>
              <Button variant="outline" size="sm" onClick={() => statementsQuery.refetch()}>Tentar novamente</Button>
            </div>
          ) : (statementsQuery.data?.rows.length ?? 0) === 0 ? (
            <EmptyState icon={FileText} title="Nenhum demonstrativo fechado" />
          ) : (
            <ul className="space-y-2">
              {statementsQuery.data!.rows.map((statement) => (
                <li key={statement.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="font-medium">{statement.month}</p>
                    <p className="text-sm text-muted-foreground">
                      Total: {fmtBRL(statement.total_cents / 100)}
                    </p>
                  </div>
                  <BotaoExportar
                    montarReport={() => buildBillingReport(statement)}
                    temKpis
                    totalLinhas={statement.lines.length}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar fechamento de {month}</DialogTitle>
            <DialogDescription>
              O fechamento usa a revisão {preview.revision}. Confira a composição antes de continuar.
            </DialogDescription>
          </DialogHeader>
          <Composition preview={preview} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={close.isPending}>Cancelar</Button>
            <Button onClick={confirmClose} disabled={close.isPending}>
              {close.isPending ? 'Fechando…' : 'Confirmar fechamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RevenueReconciliation
        orgId={orgId}
        month={month}
        candidate={candidate}
        onClose={() => setCandidate(null)}
        onDone={() => {
          setCandidate(null);
          void previewQuery.refetch();
        }}
      />
    </div>
  );
}
