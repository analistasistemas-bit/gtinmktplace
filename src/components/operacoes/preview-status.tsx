// ADR-0174 emenda 2026-10-04 — preview de pausar/reativar em massa: o que muda, o que fica de fora e os avisos.
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErroOperacao, useCriarOperacao, usePodeExecutarOperacao, type RecusaItem } from '@/hooks/useOperacoes';
import type { AcaoStatus } from '@/lib/operacoes';
import { formatarNomeProduto } from '@/lib/texto';

interface Props {
  acao: AcaoStatus;
  itens: { ml_item_id: string; titulo: string | null; thumbnail?: string | null }[];
  foraDoLote: { motivo: string; quantidade: number }[];
  origemId: string | null;
  aberto: boolean;
  onFechar: () => void;
  onCriada: (operacaoId: string) => void;
}

export function PreviewStatus({ acao, itens, foraDoLote, origemId, aberto, onFechar, onCriada }: Props) {
  const criar = useCriarOperacao();
  const podeExecutar = usePodeExecutarOperacao();
  const verbo = acao === 'pausar' ? 'Pausar' : 'Reativar';
  const rotulo = `${verbo} ${itens.length} anúncio${itens.length === 1 ? '' : 's'}`;

  const [recusas, setRecusas] = useState<RecusaItem[]>([]);
  const tituloDe = (id: string) => itens.find((i) => i.ml_item_id === id)?.titulo ?? id;
  const executar = async () => {
    setRecusas([]);
    try {
      const r = await criar.mutateAsync({ acao, origem_id: origemId, itens: itens.map((i) => ({ ml_item_id: i.ml_item_id, titulo: i.titulo })) });
      onCriada(r.operacao_id);
    } catch (e) {
      if (e instanceof ErroOperacao && e.itens?.length) setRecusas(e.itens); // mostra quais e por quê
      toast.error(e instanceof ErroOperacao ? e.message : 'Não foi possível criar a operação.');
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rotulo}</DialogTitle>
          <DialogDescription>Anúncios de catálogo ligados a estes também mudam.</DialogDescription>
        </DialogHeader>
        {acao === 'pausar' && (
          <p className="text-sm text-muted-foreground">Atenção: repor estoque reativa estes anúncios automaticamente.</p>
        )}
        {foraDoLote.map((f) => (
          <p key={f.motivo} className="text-sm text-muted-foreground">{f.quantidade} fora do lote: {f.motivo}</p>
        ))}
        {recusas.length > 0 && (
          <ul className="space-y-1 rounded border border-destructive/40 bg-destructive/5 p-2 text-sm" aria-label="Anúncios recusados">
            {recusas.map((r) => <li key={r.ml_item_id}>{tituloDe(r.ml_item_id)} ({r.ml_item_id}): {r.motivo}</li>)}
          </ul>
        )}
        <ul className="max-h-72 divide-y overflow-y-auto rounded border text-sm">
          {itens.map((i) => (
            <li key={i.ml_item_id} className="flex items-center gap-2 p-2">
              {i.thumbnail && <img src={i.thumbnail} alt="" className="h-8 w-8 rounded object-cover" />}
              <span className="min-w-0 flex-1 truncate">{i.titulo ? formatarNomeProduto(i.titulo) : i.ml_item_id}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{i.ml_item_id}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          {podeExecutar
            ? <Button onClick={executar} disabled={criar.isPending || itens.length === 0}>{rotulo}</Button>
            : <p className="text-sm text-muted-foreground">Só administradores executam.</p>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
