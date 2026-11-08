import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useExcluirFamilia } from '@/hooks/useExcluirFamilia';
import type { Familia } from '@/lib/tipos-dominio';

export function TirarDaRevisao({ familia, onTirada }: { familia: Familia; onTirada: (familiaId: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const nav = useNavigate();
  const { mutate, isPending } = useExcluirFamilia(familia.loteId);

  function confirmar() {
    mutate(familia.id, {
      onSuccess: (r) => {
        setAberto(false);
        onTirada(familia.id);
        toast.success('Família tirada da revisão');
        if (r.lote_removido) nav('/');
      },
      onError: (e) => toast.error('Não foi possível tirar', { description: e.message }),
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAberto(true)}>
        Tirar da revisão
      </Button>
      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar da revisão?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="font-medium text-foreground">PAI {familia.codigoPai} · {familia.titulo}</p>
                <p>
                  A família será apagada deste lote. O Mercado Livre não é alterado. Para trazê-la de
                  volta, suba a planilha de novo.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmar(); }}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? 'Tirando…' : 'Tirar da revisão'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
