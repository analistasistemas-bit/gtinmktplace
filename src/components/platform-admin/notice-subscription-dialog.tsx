import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useNoticeSubscription, useSaveNoticeSubscription } from '@/hooks/usePlatformAdmin';
import { validarAssinaturaAviso } from '../../../supabase/functions/_shared/platform-admin/validation';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** Aviso de fechamento mensal (ADR-0193 D-11): o super-admin assina no próprio perfil, bot da plataforma. */
export function NoticeSubscriptionDialog({ open, onOpenChange }: Props) {
  const atual = useNoticeSubscription(open);
  const save = useSaveNoticeSubscription();
  const [chatId, setChatId] = useState('');
  const [ativo, setAtivo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !atual.data) return;
    setChatId(atual.data.chat_id ?? '');
    setAtivo(atual.data.ativo);
    setErro(null);
  }, [open, atual.data]);

  async function salvar() {
    try {
      validarAssinaturaAviso({ chat_id: chatId, ativo });
    } catch (caught) {
      setErro(caught instanceof Error ? caught.message : 'Dados inválidos');
      return;
    }
    setErro(null);
    try {
      await save.mutateAsync({ chat_id: chatId.trim(), ativo });
      toast.success(ativo ? 'Aviso de fechamento ativado.' : 'Aviso de fechamento desativado.');
      onOpenChange(false);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aviso de fechamento no Telegram</DialogTitle>
          <DialogDescription>
            No dia 01, depois do fechamento automático, chega o valor a receber de cada organização e as que ficaram com pendência.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <label className="font-medium" htmlFor="aviso-chat-id">Chat ID do Telegram</label>
            <Input
              id="aviso-chat-id"
              placeholder="ex.: 123456789"
              inputMode="numeric"
              value={chatId}
              aria-invalid={!!erro || undefined}
              onChange={(e) => setChatId(e.target.value)}
              disabled={atual.isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Conversa privada (número positivo; descubra com <code>@userinfobot</code>). Mande uma mensagem ao bot da Daludi uma vez antes, senão o Telegram bloqueia o envio.
            </p>
          </div>
          <label htmlFor="aviso-ativo" className="flex items-center gap-2">
            <Checkbox id="aviso-ativo" checked={ativo} onCheckedChange={(c) => setAtivo(c === true)} disabled={atual.isLoading} />
            <span className="font-medium">Receber o aviso de fechamento mensal</span>
          </label>
          {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={save.isPending || atual.isLoading}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
