import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { requestSupport, type SupportScope } from '@/lib/suporte';

type SupportDialogOrg = { id: string; nome: string };

/** Compartilhado por `Organizacoes.tsx` (carteira) e `OrganizacaoDetalhe.tsx` (cabeçalho) — mesmo
 *  formulário de solicitação de acesso temporário à organização. */
export function SupportRequestDialog({ org, onClose, onRequested }: {
  org: SupportDialogOrg | null;
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
