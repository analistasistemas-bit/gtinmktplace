import { useMemo, useState, type ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { classificar, ordenarFila, travada, type ClasseFila, type TentativaAtiva } from '@/lib/posvenda-fila';
import type { Devolucao } from '@/lib/devolucoes';
import { labelTipoDevolucao } from '@/lib/devolucoes';
import { fmtDataHora, MSG_TRAVA, PainelReclamacao } from './detalhe-reclamacao';

const VEZ: Record<string, string> = { vendedor: 'Sua vez', comprador: 'Vez do comprador', ml: 'Vez do Mercado Livre' };

export function CardFila({ d, tentativas, agora, acaoPrimaria }: {
  d: Devolucao; tentativas: TentativaAtiva[]; agora: Date;
  /** Botão principal do card (ex.: "Revisar"); recebe se o recurso está travado. */
  acaoPrimaria: (travado: boolean) => ReactNode;
}) {
  const classe = classificar(d);
  const emEnvio = tentativas.some((t) => t.claim_id === d.claim_id);
  const travado = travada(tentativas, 'revisar_ok', d.claim_id, d.return_id ?? null) || emEnvio;
  const vencido = d.prazo != null && Date.parse(d.prazo) < agora.getTime();
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center" data-classe={classe}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{d.order_id ? `Pedido #${d.order_id}` : `Reclamação ${d.claim_id}`}</div>
        <div className="text-xs text-muted-foreground">{labelTipoDevolucao(d.type)} · {d.reason_texto ?? d.reason_id ?? 'Sem motivo informado'}</div>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5 text-xs">
        <div className="font-medium">{d.detalhe?.title ?? (d.status === 'opened' ? 'Em andamento' : 'Concluída')}</div>
        {d.detalhe?.description && <div className="line-clamp-2 text-muted-foreground">{d.detalhe.description}</div>}
        <div className="flex flex-wrap items-center gap-1.5">
          {d.revisao_pendente && <StatusPill tone="warning">Revisar produto devolvido</StatusPill>}
          {d.vez_de && <StatusPill tone={d.vez_de === 'vendedor' ? 'warning' : 'neutral'}>{VEZ[d.vez_de]}</StatusPill>}
          {d.prazo && <StatusPill tone={vencido ? 'danger' : 'neutral'}>{vencido ? 'Venceu' : 'Até'} {fmtDataHora(d.prazo).slice(0, 5)}</StatusPill>}
        </div>
        {emEnvio && <div role="status" className="text-info">{MSG_TRAVA}</div>}
      </div>
      <div className="shrink-0">{acaoPrimaria(travado)}</div>
    </div>
  );
}

function Resumo({ titulo, tom, n }: { titulo: string; tom: 'warning' | 'neutral'; n: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm">
      <span className="font-medium">{titulo}</span><StatusPill tone={tom}>{n}</StatusPill>
    </div>
  );
}

/** Cards Urgentes / Em andamento + lista ordenada por prazo. `renderAcao` define o botão do card. */
export function ListaFila({ itens, tentativas, vazio, renderAcao }: {
  itens: Devolucao[]; tentativas: TentativaAtiva[]; vazio: string;
  renderAcao: (d: Devolucao, travado: boolean) => ReactNode;
}) {
  const agora = useMemo(() => new Date(), []);
  const grupos = useMemo(() => {
    const g: Record<ClasseFila, Devolucao[]> = { urgente: [], andamento: [], concluida: [] };
    for (const d of itens) g[classificar(d)].push(d);
    return { urgente: ordenarFila(g.urgente, agora), andamento: ordenarFila(g.andamento, agora) };
  }, [itens, agora]);

  if (!grupos.urgente.length && !grupos.andamento.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        <Inbox className="h-6 w-6" />{vazio}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Resumo titulo="Urgentes" tom="warning" n={grupos.urgente.length} />
        <Resumo titulo="Em andamento" tom="neutral" n={grupos.andamento.length} />
      </div>
      {[...grupos.urgente, ...grupos.andamento].map((d) => (
        <CardFila key={d.id ?? d.claim_id} d={d} tentativas={tentativas} agora={agora} acaoPrimaria={(t) => renderAcao(d, t)} />
      ))}
    </div>
  );
}

export function ListaReclamacoes({ itens, tentativas }: { itens: Devolucao[]; tentativas: TentativaAtiva[] }) {
  const [aberto, setAberto] = useState<Devolucao | null>(null);
  return (
    <>
      <ListaFila itens={itens} tentativas={tentativas} vazio="Nenhuma reclamação em aberto."
        renderAcao={(d) => <Button variant="outline" size="sm" onClick={() => setAberto(d)}>Ver detalhe</Button>} />
      <PainelReclamacao item={aberto} tentativas={tentativas} onOpenChange={(v) => { if (!v) setAberto(null); }} />
    </>
  );
}
