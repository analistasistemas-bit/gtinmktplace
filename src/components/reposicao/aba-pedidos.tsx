// Spec §3.5: aba Pedidos: os 6 estados com o alerta Atrasado; detalhe com pedido × recebido por item,
// atraso real em dias, Encerrar saldo e Reabrir saldo (Task 7 encerra pela entrada; aqui se desfaz).
import { useState } from 'react';
import { ChevronDown, ChevronRight, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtInt } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { FamiliaTela, PedidoDTO, SkuTela, StatusPedido } from '../../../supabase/functions/_shared/reposicao/tipos';
import { totaisPedido, ValorPedido } from './barra-rascunho';
import { fmtDia } from './por-que';
import { itensComSaldo } from './recebimento-pedido';
import { ROTULO_STATUS, TOM_STATUS } from './sheet-pedido';
import { itensOrdenados } from './texto-whatsapp';

const ORDEM: StatusPedido[] = ['rascunho', 'aprovado', 'enviado', 'parcial', 'recebido', 'saldo_encerrado'];
const ENCERRAVEL = new Set<StatusPedido>(['aprovado', 'enviado', 'parcial']);
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

export interface AcoesPedidos {
  onAbrir: (id: string) => void;
  onEncerrar: (pedidoId: string) => void;
  onReabrir: (pedidoId: string, codigo: string) => void;
}

function CardPedido({ p, skus, familias, hoje, acoes, pendente }: {
  p: PedidoDTO; skus: SkuTela[]; familias: FamiliaTela[]; hoje: string; acoes: AcoesPedidos; pendente: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const t = totaisPedido(p, skus);
  const recebida = p.itens.reduce((a, i) => a + i.recebida, 0);
  const atraso = p.atrasado && p.previstoPara ? diasEntre(p.previstoPara, hoje) : 0;
  const Seta = aberto ? ChevronDown : ChevronRight;
  const detalheId = `pedido-${p.id}`;
  return (
    <li className={cn('border-l-4 border-l-transparent', p.atrasado && 'border-l-danger')}>
      {/* Celular: fornecedor numa linha inteira e os metadados quebram embaixo. Desktop largo: colunas fixas, alinhadas entre os pedidos. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 text-sm lg:grid lg:grid-cols-[minmax(0,1fr)_13rem_6.5rem_10rem_12rem_auto] lg:items-center">
        <button
          type="button" aria-expanded={aberto} aria-controls={detalheId} onClick={() => setAberto((v) => !v)}
          className="flex min-h-11 min-w-0 basis-full items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0 lg:basis-auto lg:flex-1"
        >
          <Seta className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Ver itens de {p.fornecedor.nome}</span>
          <span aria-hidden className="truncate font-medium">{p.fornecedor.nome}</span>
        </button>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={TOM_STATUS[p.status]}>{ROTULO_STATUS[p.status]}</StatusPill>
          {p.atrasado && (
            <StatusPill tone="danger">{atraso > 0 ? `Atrasado · ${atraso} ${atraso === 1 ? 'dia' : 'dias'}` : 'Atrasado'}</StatusPill>
          )}
        </span>
        <span className="text-caption tabular-nums">{p.previstoPara ? `previsto ${fmtDia(p.previstoPara)}` : 'sem data'}</span>
        <span className="tabular-nums">{fmtInt(t.unidades)} un. · <ValorPedido valor={t.valor} semCusto={t.semCusto} /></span>
        {p.status !== 'rascunho' ? (
          <span className="flex items-center gap-2 text-caption tabular-nums">
            {`${fmtInt(recebida)} de ${fmtInt(t.unidades)} recebidas`}
            <span aria-hidden className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-success" style={{ width: `${t.unidades ? Math.min(100, (recebida / t.unidades) * 100) : 0}%` }} />
            </span>
          </span>
        ) : <span aria-hidden className="hidden lg:block" />}
        <Button size="sm" variant="outline" className="h-11 md:h-8" aria-label={`${p.status === 'rascunho' ? 'Revisar rascunho' : 'Abrir pedido'} de ${p.fornecedor.nome}`} onClick={() => acoes.onAbrir(p.id)}>
          {p.status === 'rascunho' ? 'Revisar' : 'Abrir'}
        </Button>
      </div>
      {aberto && (
        <div id={detalheId} className="flex flex-col gap-3 border-t border-border bg-muted/20 px-3 py-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 md:pl-9">
          {p.atrasado && atraso > 0 && p.previstoPara && (
            <p className="text-sm text-danger">Previsto para {fmtDia(p.previstoPara)}: {atraso} {atraso === 1 ? 'dia' : 'dias'} de atraso.</p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-medium">Item</th>
                <th className="py-1 text-right font-medium">Recebido</th>
                <th className="py-1 text-right font-medium"><span className="sr-only">Situação</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itensOrdenados(p, skus, familias).map((l) => (
                <tr key={l.item.codigo}>
                  <td className="py-1.5 pr-2">{l.rotulo}</td>
                  <td className="py-1.5 text-right tabular-nums">{`${fmtInt(l.item.recebida)} de ${fmtInt(l.item.quantidade)}`}</td>
                  <td className="py-1.5 pl-2 text-right">
                    {l.item.encerrado && l.item.recebida < l.item.quantidade && (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-caption">Saldo encerrado</span>
                        <Button size="sm" variant="ghost" className="h-11 md:h-7" disabled={pendente}
                          aria-label={`Reabrir saldo de ${l.rotulo}`} onClick={() => acoes.onReabrir(p.id, l.item.codigo)}>
                          Reabrir saldo
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ENCERRAVEL.has(p.status) && itensComSaldo(p).length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-11 md:h-8" disabled={pendente} onClick={() => setConfirmando(true)}>
                Encerrar saldo
              </Button>
              <span className="text-caption">O restante não vem mais; dá para reabrir depois.</span>
            </div>
          )}
          <ConfirmarEncerrar p={p} skus={skus} familias={familias} aberto={confirmando} onAberto={setConfirmando}
            onConfirmar={() => acoes.onEncerrar(p.id)} />
        </div>
      )}
    </li>
  );
}

/** Spec §3.5: lista os itens que serão encerrados e o saldo de cada um antes de encerrar. Encerrar tira o
 *  saldo do "a caminho" e a sugestão sobe na hora; desfazer é item a item ("Reabrir saldo"). */
function ConfirmarEncerrar({ p, skus, familias, aberto, onAberto, onConfirmar }: {
  p: PedidoDTO; skus: SkuTela[]; familias: FamiliaTela[]; aberto: boolean; onAberto: (v: boolean) => void; onConfirmar: () => void;
}) {
  const comSaldo = new Set(itensComSaldo(p).map((i) => i.codigo));
  const itens = aberto ? itensOrdenados(p, skus, familias).filter((l) => comSaldo.has(l.item.codigo)) : [];
  return (
    <AlertDialog open={aberto} onOpenChange={onAberto}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Encerrar o saldo do pedido de {p.fornecedor.nome}?</AlertDialogTitle>
          <AlertDialogDescription>
            O que falta destes itens deixa de contar como a caminho, e a sugestão de reposição volta a pedir. Dá para reabrir item a item.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex max-h-60 flex-col divide-y divide-border overflow-y-auto rounded-lg bg-muted/40 text-sm">
          {itens.map((l) => (
            <li key={l.item.codigo} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>{l.rotulo}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{`faltam ${fmtInt(l.item.quantidade - l.item.recebida)}`}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 md:h-9">Voltar</AlertDialogCancel>
          <AlertDialogAction className="h-11 md:h-9" onClick={onConfirmar}>Encerrar saldo</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AbaPedidos({ pedidos, skus, familias, hoje, acoes, pendente }: {
  pedidos: PedidoDTO[]; skus: SkuTela[]; familias: FamiliaTela[]; hoje: string; acoes: AcoesPedidos; pendente: boolean;
}) {
  if (!pedidos.length) {
    return <EmptyState icon={ShoppingCart} title="Nenhum pedido ainda." description="Monte um na aba Sugestões com “Adicionar ao pedido”." />;
  }
  // Atrasado primeiro; depois em aberto antes de fechado; depois a data prevista.
  const lista = [...pedidos].sort((a, b) => Number(b.atrasado) - Number(a.atrasado)
    || ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status)
    || (a.previstoPara ?? '9').localeCompare(b.previstoPara ?? '9'));
  return (
    <ul aria-label="Pedidos de compra" className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/5">
      {lista.map((p) => <CardPedido key={p.id} p={p} skus={skus} familias={familias} hoje={hoje} acoes={acoes} pendente={pendente} />)}
    </ul>
  );
}
