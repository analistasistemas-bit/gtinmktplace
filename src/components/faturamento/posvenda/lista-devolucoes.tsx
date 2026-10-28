import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buscarDetalheReclamacao } from '@/lib/posvenda';
import type { TentativaAtiva } from '@/lib/posvenda-fila';
import type { Devolucao } from '@/lib/devolucoes';
import { urlVendaML } from '@/lib/ml-status';
import { QK_POSVENDA } from '@/hooks/usePosvenda';
import { ListaFila } from './lista-reclamacoes';
import { PainelReclamacao } from './detalhe-reclamacao';
import { DialogoRevisarDevolucao } from './dialogo-revisar-devolucao';

/** Relê a reclamação no ML e só então abre o diálogo (o formulário usa os motivos/pedidos atuais). */
function RevisarDoCard({ d, onFechar }: { d: Devolucao; onFechar: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...QK_POSVENDA, 'detalhe', d.claim_id], staleTime: 0, gcTime: 0,
    queryFn: () => buscarDetalheReclamacao(String(d.claim_id)),
  });
  if (!q.data) {
    return (
      <div className="fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-3 rounded-lg border bg-popover p-3 text-sm shadow-lg sm:left-auto sm:w-80">
        {q.isError ? <span className="text-destructive">{(q.error as Error).message}</span>
          : <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Lendo do Mercado Livre…</span>}
        <Button size="sm" variant="ghost" onClick={onFechar}>Fechar</Button>
      </div>
    );
  }
  return (
    <DialogoRevisarDevolucao
      detalhe={q.data} open onOpenChange={(v) => { if (!v) onFechar(); }}
      onConcluido={() => { void qc.invalidateQueries({ queryKey: QK_POSVENDA }); void qc.invalidateQueries({ queryKey: ['devolucoes'] }); }}
      info={{
        titulo: `Pedido #${d.order_id ?? '—'}`,
        linkML: d.order_id ? urlVendaML(d.pack_id ?? d.order_id) : undefined,
        linhas: [['Motivo', d.reason_texto ?? '—'], ['Rastreio', d.rastreio ?? '—'], ['Reputação', d.afeta_reputacao ?? '—']],
      }}
    />
  );
}

export function ListaDevolucoes({ itens, tentativas }: { itens: Devolucao[]; tentativas: TentativaAtiva[] }) {
  const [detalhe, setDetalhe] = useState<Devolucao | null>(null);
  const [revisando, setRevisando] = useState<Devolucao | null>(null);
  return (
    <>
      <ListaFila itens={itens} tentativas={tentativas} vazio="Nenhuma devolução em andamento."
        renderAcao={(d, travado) => d.revisao_pendente
          ? <Button size="sm" disabled={travado} title={travado ? 'Ação enviada ao ML · aguardando confirmação' : undefined} onClick={() => setRevisando(d)}>Revisar</Button>
          : <Button size="sm" variant="outline" onClick={() => setDetalhe(d)}>Ver detalhe</Button>} />
      {revisando && <RevisarDoCard d={revisando} onFechar={() => setRevisando(null)} />}
      <PainelReclamacao item={detalhe} tentativas={tentativas} onOpenChange={(v) => { if (!v) setDetalhe(null); }} />
    </>
  );
}
