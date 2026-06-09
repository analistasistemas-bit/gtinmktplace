import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { StatusBadge } from '@/components/status-badge';
import { useExcluirLote } from '@/hooks/useExcluirLote';
import type { Lote, LoteStatus } from '@/lib/tipos-dominio';

function destinoDoLote(status: LoteStatus, id: string): string {
  if (status === 'revisao') return `/revisao/${id}`;
  if (status === 'concluido' || status === 'erro') return `/relatorio/${id}`;
  return `/progresso/${id}`;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoteCard({ lote }: { lote: Lote }) {
  const [dialogAberto, setDialogAberto] = useState(false);
  const { mutate: excluir, isPending, error } = useExcluirLote();

  const bloqueado = lote.status === 'processando' || lote.status === 'publicando';

  function handleTrashClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDialogAberto(true);
  }

  function handleConfirmar() {
    excluir(lote.id, {
      onSuccess: (res) => {
        setDialogAberto(false);
        const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
        const partes = [
          plural(res.familias_removidas, 'família removida', 'famílias removidas'),
          plural(res.imagens_removidas, 'imagem', 'imagens'),
        ];
        if (res.familias_preservadas > 0) {
          partes.push(plural(res.familias_preservadas, 'família preservada', 'famílias preservadas'));
        }
        toast.success(`Lote #${lote.numero} excluído`, { description: partes.join(' · ') });
      },
      onError: (err) => {
        toast.error(`Falha ao excluir o lote #${lote.numero}`, {
          description: err instanceof Error ? err.message : String(err),
        });
      },
    });
  }

  return (
    <>
      <Link to={destinoDoLote(lote.status, lote.id)} className="block">
        <Card className="relative p-4 transition-colors hover:bg-accent">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Lote #{lote.numero}</h3>
                <StatusBadge status={lote.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{formatarData(lote.criadoEm)}</p>
            </div>
            <div className="flex items-start gap-2">
              <div className="text-right text-sm text-muted-foreground">
                <div>{lote.totalFamilias} famílias</div>
                {lote.status === 'concluido' && (
                  <div className="text-xs">
                    {lote.totalPublicadas} publicadas · {lote.totalErros}{' '}
                    {lote.totalErros === 1 ? 'erro' : 'erros'}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                disabled={bloqueado}
                aria-label={bloqueado ? 'Aguarde o processamento/publicação terminar' : 'Excluir lote'}
                title={bloqueado ? 'Aguarde o processamento/publicação terminar' : 'Excluir lote'}
                onClick={handleTrashClick}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </Link>

      <AlertDialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lote #{lote.numero}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Famílias <strong>não publicadas</strong> serão removidas permanentemente junto
                  com suas imagens.
                </p>
                <p>
                  Famílias <strong>publicadas serão preservadas</strong> — continuam no menu
                  Publicados e mantêm o vínculo para futuros UPDATEs.
                </p>
                <p>O Mercado Livre não é tocado por esta ação.</p>
                {isPending && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2 text-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="font-medium">Excluindo lote…</span>
                    </div>
                    <div className="track-indeterminate" role="progressbar" aria-label="Excluindo lote" />
                    <p className="text-xs text-muted-foreground">
                      Removendo famílias e imagens. Isso pode levar alguns segundos.
                    </p>
                  </div>
                )}
                {error && !isPending && (
                  <p className="text-destructive">
                    {error instanceof Error ? error.message : String(error)}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmar(); }}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
