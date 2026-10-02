import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type Props = {
  org: { id: string; nome: string; slug: string } | null;
  modo: 'arquivar' | 'desarquivar';
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

/** ADR-0175: confirma arquivar/desarquivar organização digitando o slug. */
export function DialogArquivarOrg({ org, modo, onClose, onConfirm }: Props) {
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const arquivar = modo === 'arquivar';
  const rotulo = arquivar ? 'Arquivar' : 'Desarquivar';

  async function confirmar() {
    setEnviando(true);
    try {
      await onConfirm();
      setValor('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Falha ao ${modo}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(aberto) => { if (!aberto) { setValor(''); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rotulo} organização</DialogTitle>
          <DialogDescription>
            {arquivar
              ? <>Arquivar <strong>{org?.nome}</strong>? A conexão com o Mercado Livre será removida e a empresa deixa de sincronizar. Pause os anúncios no ML antes. Para desfazer, desarquive e reconecte o ML em Canais.</>
              : <>Desarquivar <strong>{org?.nome}</strong>? A empresa volta à carteira; para sincronizar de novo, reconecte o Mercado Livre em Canais.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="arquivar-org-slug">Digite <strong>{org?.slug}</strong> para confirmar</label>
          <Input id="arquivar-org-slug" value={valor} onChange={(e) => setValor(e.target.value)} autoComplete="off" />
        </div>
        <DialogFooter>
          <Button
            variant={arquivar ? 'destructive' : 'default'}
            disabled={valor !== org?.slug || enviando}
            onClick={confirmar}
          >
            {rotulo}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
