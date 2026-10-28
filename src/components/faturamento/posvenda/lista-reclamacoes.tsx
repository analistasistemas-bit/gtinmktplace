import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import {
  classificar, filtroCasa, ordenarFila, travada, type FiltroFila, type ProdutoPedido,
} from '@/lib/posvenda-fila';
import { verificarAcaoPosvenda, type TentativaAtivaPosvenda } from '@/lib/posvenda';
import { labelTipoDevolucao, type Devolucao } from '@/lib/devolucoes';
import { fmtBRL } from '@/lib/formato';
import { urlVendaML } from '@/lib/ml-status';
import { QK_POSVENDA, useProdutosPedidos } from '@/hooks/usePosvenda';
import { ThumbProduto } from '@/components/faturamento/pilha-thumbs';
import { fmtDataHora, MSG_TRAVA, PainelReclamacao } from './detalhe-reclamacao';

/** `null` = ainda não sabemos quais ações estão em andamento (carregando/erro): tudo indisponível. */
export type Travas = TentativaAtivaPosvenda[] | null;

const VEZ: Record<string, string> = { vendedor: 'Sua vez', comprador: 'Vez do comprador', ml: 'Vez do Mercado Livre' };

function Conferir({ t, d }: { t: TentativaAtivaPosvenda; d: Devolucao }) {
  const qc = useQueryClient();
  const [lendo, setLendo] = useState(false);
  const conferir = async () => {
    setLendo(true);
    try {
      const r = await verificarAcaoPosvenda(t.operacao_id, String(t.claim_id)); // só relê; nunca reenvia
      toast.info(r.estado === 'confirmada' ? 'Confirmado pelo Mercado Livre.' : 'Ainda sem confirmação do Mercado Livre.');
      await qc.invalidateQueries({ queryKey: QK_POSVENDA });
      void qc.invalidateQueries({ queryKey: ['devolucoes'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLendo(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={lendo} onClick={() => void conferir()}>
        {lendo && <Loader2 className="h-3 w-3 animate-spin" />}Conferir agora
      </Button>
      <a className="inline-flex items-center gap-1 underline" target="_blank" rel="noreferrer"
        href={d.order_id ? urlVendaML(d.pack_id ?? d.order_id) : 'https://www.mercadolivre.com.br/vendas/lista'}>
        Conferir no ML<ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

export function CardFila({ d, travas, agora, produto, acaoPrimaria }: {
  d: Devolucao; travas: Travas; agora: Date; produto?: ProdutoPedido;
  /** Botão principal do card; recebe se a ação principal está travada (recurso da tentativa ativa). */
  acaoPrimaria: (travado: boolean) => ReactNode;
}) {
  const classe = classificar(d);
  const ativas = (travas ?? []).filter((t) => t.claim_id === d.claim_id);
  // Trava por RECURSO (revisão = return:{id}); tentativa de mensagem não trava a revisão.
  const travado = travas === null || travada(travas, 'revisar_ok', d.claim_id, d.return_id ?? null);
  const vencido = d.prazo != null && Date.parse(d.prazo) < agora.getTime();
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center" data-classe={classe}>
      <div className="flex min-w-0 flex-1 gap-3">
        <ThumbProduto path={produto?.fotoPath ?? null} titulo={produto?.titulo ?? null} size={44} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{produto?.titulo ?? (d.order_id ? `Pedido #${d.order_id}` : `Reclamação ${d.claim_id}`)}</div>
          {produto && (
            <div className="text-xs text-muted-foreground">
              {d.order_id ? `Pedido #${d.order_id}` : `Reclamação ${d.claim_id}`} · {produto.quantidade} un · {fmtBRL(produto.valor)}
            </div>
          )}
          <div className="text-xs text-muted-foreground">{labelTipoDevolucao(d.type)} · {d.reason_texto ?? d.reason_id ?? 'Sem motivo informado'}</div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5 text-xs">
        <div className="font-medium">{d.detalhe?.title ?? (d.status === 'opened' ? 'Em andamento' : 'Concluída')}</div>
        {d.detalhe?.description && <div className="line-clamp-2 text-muted-foreground">{d.detalhe.description}</div>}
        <div className="flex flex-wrap items-center gap-1.5">
          {d.revisao_pendente && <StatusPill tone="warning">Revisar produto devolvido</StatusPill>}
          {d.vez_de && <StatusPill tone={d.vez_de === 'vendedor' ? 'warning' : 'neutral'}>{VEZ[d.vez_de]}</StatusPill>}
          {d.prazo && <StatusPill tone={vencido ? 'danger' : 'neutral'}>{vencido ? 'Venceu' : 'Até'} {fmtDataHora(d.prazo).slice(0, 5)}</StatusPill>}
        </div>
        {ativas.length > 0 && (
          <div role="status" className="space-y-1 text-info">
            <div>{MSG_TRAVA}</div>
            {ativas.map((t) => <Conferir key={t.operacao_id} t={t} d={d} />)}
          </div>
        )}
      </div>
      <div className="shrink-0">{acaoPrimaria(travado)}</div>
    </div>
  );
}

function Contador({ rotulo, n, ativo, onClick, className }: { rotulo: string; n: number; ativo: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" aria-pressed={ativo} onClick={onClick}
      className={cn('flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-muted', ativo && 'bg-primary/10 ring-1 ring-primary', className)}>
      <span>{rotulo}</span><span className="tabular-nums text-muted-foreground">{n}</span>
    </button>
  );
}

/** Cards Urgentes / Em andamento (clicáveis: filtram a lista) + lista ordenada por prazo. */
export function ListaFila({ itens, travas, vazio, renderAcao }: {
  itens: Devolucao[]; travas: Travas; vazio: string;
  renderAcao: (d: Devolucao, travado: boolean, produto?: ProdutoPedido) => ReactNode;
}) {
  const agora = useMemo(() => new Date(), []);
  const [filtro, setFiltro] = useState<FiltroFila | null>(null);
  const produtos = useProdutosPedidos(itens.map((d) => d.order_id));
  const n = (f: FiltroFila) => itens.filter((d) => filtroCasa(f, d)).length;
  const ativos = useMemo(() => ordenarFila(itens.filter((d) => classificar(d) !== 'concluida'), agora), [itens, agora]);
  const visiveis = filtro ? ativos.filter((d) => filtroCasa(filtro, d)) : ativos;
  const alterna = (f: FiltroFila) => setFiltro((atual) => (atual === f ? null : f));

  if (!ativos.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        <Inbox className="h-6 w-6" />{vazio}
      </div>
    );
  }
  const caixa = (titulo: string, f: FiltroFila, subs: Array<[string, FiltroFila]>) => (
    <div className={cn('space-y-0.5 rounded-lg border bg-card p-1.5', f === 'urgente' && 'border-warning/40')}>
      <Contador rotulo={titulo} n={n(f)} ativo={filtro === f} onClick={() => alterna(f)} className="font-medium" />
      {subs.filter(([, sf]) => n(sf) > 0).map(([r, sf]) => (
        <Contador key={sf} rotulo={r} n={n(sf)} ativo={filtro === sf} onClick={() => alterna(sf)} className="pl-5 text-xs" />
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {caixa('Urgentes', 'urgente', [['Revisar produto devolvido', 'revisar'], ['Sua vez de agir', 'sua_vez']])}
        {caixa('Em andamento', 'andamento', [['A caminho', 'a_caminho'], ['Vez do comprador', 'vez_comprador']])}
      </div>
      {filtro && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Mostrando {visiveis.length} de {ativos.length}</span>
          <Button size="sm" variant="ghost" onClick={() => setFiltro(null)}>Limpar filtro</Button>
        </div>
      )}
      {visiveis.length === 0 && <p className="text-sm text-muted-foreground">Nenhum item neste filtro.</p>}
      {visiveis.map((d) => {
        const produto = d.order_id != null ? produtos.get(d.order_id) : undefined;
        return <CardFila key={d.id ?? d.claim_id} d={d} travas={travas} agora={agora} produto={produto} acaoPrimaria={(t) => renderAcao(d, t, produto)} />;
      })}
    </div>
  );
}

export function ListaReclamacoes({ itens, travas }: { itens: Devolucao[]; travas: Travas }) {
  const [aberto, setAberto] = useState<Devolucao | null>(null);
  return (
    <>
      <ListaFila itens={itens} travas={travas} vazio="Nenhuma reclamação em aberto."
        renderAcao={(d) => <Button variant="outline" size="sm" onClick={() => setAberto(d)}>Ver detalhe</Button>} />
      <PainelReclamacao item={aberto} travas={travas} onOpenChange={(v) => { if (!v) setAberto(null); }} />
    </>
  );
}
