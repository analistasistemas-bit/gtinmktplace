import { useMemo, useState } from 'react';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { RevenueReconciliation, type ReconciliationCandidate } from '@/components/platform-admin/revenue-reconciliation';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useClosePlatformStatement,
  usePlatformPreview,
  usePlatformStatements,
} from '@/hooks/usePlatformAdmin';
import { buildBillingReport } from '@/lib/export/platform-billing';
import { fmtBRL } from '@/lib/formato';
import type { BillingLine, BillingPreview, PlatformAdminError } from '@/lib/platform-admin';

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
  if (bps == null) return 'Não definido';
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

function Composition({ preview }: { preview: BillingPreview }) {
  const setup = amount(preview.lines, 'setup');
  const infrastructure = amount(preview.lines, 'infrastructure');
  const credits = amount(preview.lines, 'credits');
  const rows = [
    ['Receita bruta', preview.gross_cents],
    ['Ajustes da base', -preview.refund_cents],
    [`Percentual (${humanPercent(preview.terms?.revenue_bps)})`, preview.fee_cents],
    ['Infraestrutura', infrastructure],
    [`Consultas Sonar (${preview.sonar_units})`, preview.sonar_cents],
    ['Implantação', setup],
    ['Créditos', credits || -preview.credit_cents],
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
  const close = useClosePlatformStatement();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ReconciliationCandidate | null>(null);
  const completedMonth = useMemo(() => month < currentFortalezaMonth(), [month]);
  const preview = previewQuery.data;
  const canClose = Boolean(preview?.terms && preview.blockers.length === 0 && completedMonth);

  async function confirmClose() {
    if (!preview || !canClose) return;
    setMessage(null);
    try {
      await close.mutateAsync({
        org_id: orgId,
        month,
        expected_revision: preview.revision,
      });
      setConfirming(false);
      setMessage('Demonstrativo fechado.');
    } catch (caught) {
      const error = caught as PlatformAdminError & { status?: number };
      if (error.code === 'conflict' || error.status === 409) {
        setConfirming(false);
        await previewQuery.refetch();
        setMessage('A prévia mudou. Revise os novos valores e confirme novamente.');
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Não foi possível fechar o demonstrativo.');
    }
  }

  if (previewQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando cobrança…</p>;
  }
  if (!preview) {
    return <p className="text-sm text-destructive" role="alert">Não foi possível carregar a cobrança.</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Prévia de cobrança · {month}</CardTitle>
          <CardAction>
            <Button disabled={!canClose || close.isPending} onClick={() => setConfirming(true)}>
              Fechar demonstrativo
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <Composition preview={preview} />
          {!preview.terms && (
            <p className="text-sm text-warning" role="alert">Cadastre condições comerciais antes de fechar.</p>
          )}
          {!completedMonth && (
            <p className="text-sm text-warning" role="alert">O mês atual ou futuro ainda não pode ser fechado.</p>
          )}
          {preview.blockers.length > 0 && (
            <div className="space-y-2" aria-label="Pendências da cobrança">
              {preview.blockers.map((blocker, index) => {
                const reconciliation = candidateFrom(preview, index);
                return (
                  <div key={`${blocker.code}-${blocker.sale_id ?? index}`} className="flex items-center justify-between gap-3 rounded-md border border-warning/30 p-3">
                    <p className="text-sm">{blocker.message}</p>
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
          {message && <p role="status" className="text-sm">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Demonstrativos fechados</CardTitle></CardHeader>
        <CardContent>
          {statementsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando demonstrativos…</p>
          ) : (statementsQuery.data?.rows.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum demonstrativo fechado.</p>
          ) : (
            <ul className="space-y-2">
              {statementsQuery.data!.rows.map((statement) => (
                <li key={statement.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="font-medium">{statement.month}</p>
                    <p className="text-sm text-muted-foreground">
                      Total do snapshot: {fmtBRL(statement.total_cents / 100)}
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
