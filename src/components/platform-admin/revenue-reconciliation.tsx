import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useReconcilePlatformRevenue } from '@/hooks/usePlatformAdmin';
import { fmtBRL } from '@/lib/formato';

export type ReconciliationCandidate = {
  sale_id: string;
  order_ref: string | null;
  source_updated_at: string;
  gross_cents: number;
  status: string;
};

type Props = {
  orgId: string;
  month: string;
  candidate: ReconciliationCandidate | null;
  onClose: () => void;
  onDone: () => void;
};

function parseMoney(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ''] = normalized.split('.').join('').split(',');
  const cents = Number(`${whole}${decimal.padEnd(2, '0')}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function RevenueReconciliation({ orgId, month, candidate, onClose, onDone }: Props) {
  const reconcile = useReconcilePlatformRevenue(month);
  const [refunded, setRefunded] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!candidate) return;
    const refundedCents = parseMoney(refunded);
    if (refundedCents === null) {
      setError('Informe o valor devolvido em reais, positivo ou zero.');
      return;
    }
    if (refundedCents > candidate.gross_cents) {
      setError('O valor devolvido não pode superar o bruto da venda.');
      return;
    }
    if (!reason.trim()) {
      setError('Informe o motivo da conciliação.');
      return;
    }
    setError(null);
    try {
      await reconcile.mutateAsync({
        org_id: orgId,
        sale_id: candidate.sale_id,
        source_updated_at: candidate.source_updated_at,
        refunded_product_cents: refundedCents,
        reason: reason.trim(),
      });
      setRefunded('');
      setReason('');
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível conciliar a venda.');
    }
  }

  return (
    <Dialog open={candidate !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conciliar devolução</DialogTitle>
          <DialogDescription>
            Revise a venda e informe somente o valor dos produtos devolvidos.
          </DialogDescription>
        </DialogHeader>
        {candidate && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-2 rounded-md border p-3">
              <dt className="text-muted-foreground">Venda</dt>
              <dd>{candidate.order_ref || candidate.sale_id}</dd>
              <dt className="text-muted-foreground">Bruto da venda</dt>
              <dd>{fmtBRL(candidate.gross_cents / 100)}</dd>
              <dt className="text-muted-foreground">Status da origem</dt>
              <dd>{candidate.status}</dd>
              <dt className="text-muted-foreground">Atualizada em</dt>
              <dd>{candidate.source_updated_at}</dd>
            </dl>
            <label className="block space-y-1" htmlFor="reconciliation-refunded">
              <span className="font-medium">Produtos devolvidos</span>
              <Input
                id="reconciliation-refunded"
                aria-label="Produtos devolvidos"
                inputMode="decimal"
                value={refunded}
                onChange={(event) => setRefunded(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="font-medium">Motivo da conciliação</span>
              <textarea
                aria-label="Motivo da conciliação"
                className="min-h-20 w-full rounded-md border border-input bg-background p-2"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && <p role="alert" className="text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={reconcile.isPending}>Cancelar</Button>
          <Button onClick={submit} disabled={!candidate || reconcile.isPending}>
            {reconcile.isPending ? 'Conciliando…' : 'Salvar conciliação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
