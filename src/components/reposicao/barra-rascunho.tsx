// Spec §3.5 e §5: um rascunho por fornecedor, fixo no rodapé (desktop) ou atrás do botão flutuante
// "Pedidos (N)" (celular). Rascunho é da org: todo membro vê quem salvou e quando.
import { useState } from 'react';
import { ChevronRight, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type { PedidoDTO, SkuTela } from '../../../supabase/functions/_shared/reposicao/tipos';

/** Unidades e R$ pelo custo. SKU sem custo conta 0 (como na sugestão) e entra em `semCusto`, que a tela avisa. */
export function totaisPedido(pedido: PedidoDTO, skus: SkuTela[]): { unidades: number; valor: number; semCusto: number } {
  const custo = new Map(skus.map((s) => [s.codigo, s.custo]));
  return pedido.itens.reduce((a, i) => {
    const c = custo.get(i.codigo) ?? null;
    return { unidades: a.unidades + i.quantidade, valor: a.valor + i.quantidade * (c ?? 0), semCusto: a.semCusto + (c === null ? 1 : 0) };
  }, { unidades: 0, valor: 0, semCusto: 0 });
}

/** "R$ 40,00 · 1 sem custo": o R$ não esconde que faltou custo em algum item. */
export function ValorPedido({ valor, semCusto }: { valor: number; semCusto: number }) {
  if (!semCusto) return <>{fmtBRL(valor)}</>;
  const dica = `${semCusto} ${semCusto === 1 ? 'item' : 'itens'} sem custo cadastrado: o valor não conta ${semCusto === 1 ? 'esse item' : 'esses itens'}.`;
  return <span title={dica} aria-label={`${fmtBRL(valor)}, ${dica}`}>{fmtBRL(valor)} · {semCusto} sem custo</span>;
}

/** ISO → "16/11 14:02" no horário de Brasília. */
export function fmtQuando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

function LinhaRascunho({ r, skus, onRevisar }: { r: PedidoDTO; skus: SkuTela[]; onRevisar: (id: string) => void }) {
  const t = totaisPedido(r, skus);
  const salvo = r.salvoEm ? `salvo ${fmtQuando(r.salvoEm)}${r.salvoPor ? ` por ${r.salvoPor}` : ''}` : null;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Rascunho</span>
        <span className="truncate font-medium">{r.fornecedor.nome}</span>
      </span>
      <span className="tabular-nums">{fmtInt(t.unidades)} un. · <ValorPedido valor={t.valor} semCusto={t.semCusto} /></span>
      {salvo && <span className="text-caption">{salvo}</span>}
      <Button size="sm" variant="outline" className="ml-auto h-11 md:h-8" aria-label={`Revisar rascunho de ${r.fornecedor.nome}`} onClick={() => onRevisar(r.id)}>
        Revisar <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
    </li>
  );
}

export function BarraRascunho({ rascunhos, skus, onRevisar }: { rascunhos: PedidoDTO[]; skus: SkuTela[]; onRevisar: (id: string) => void }) {
  const [listaAberta, setListaAberta] = useState(false);
  if (!rascunhos.length) return null;
  const linhas = (fechar?: () => void) => rascunhos.map((r) => (
    <LinhaRascunho key={r.id} r={r} skus={skus} onRevisar={(id) => { fechar?.(); onRevisar(id); }} />
  ));
  return (
    <>
      <section
        aria-label="Rascunhos de pedido"
        className="sticky bottom-4 z-20 hidden overflow-hidden rounded-xl border-l-4 border-l-primary bg-card/95 text-sm shadow-lg ring-1 ring-foreground/5 backdrop-blur supports-[backdrop-filter]:bg-card/85 md:block"
      >
        <ul className="max-h-48 divide-y divide-border overflow-y-auto">{linhas()}</ul>
      </section>

      <Button
        aria-haspopup="dialog"
        className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-12 rounded-full px-5 shadow-lg md:hidden"
        onClick={() => setListaAberta(true)}
      >
        <ShoppingCart className="h-4 w-4" aria-hidden />Pedidos ({rascunhos.length})
      </Button>
      <Sheet open={listaAberta} onOpenChange={setListaAberta}>
        <SheetContent side="bottom" className="max-h-[80dvh] rounded-t-xl md:hidden">
          <SheetHeader className="pb-0">
            <SheetTitle>Rascunhos de pedido</SheetTitle>
            <SheetDescription>Um por fornecedor. Revise e aprove para virar pedido.</SheetDescription>
          </SheetHeader>
          <ul className="divide-y divide-border overflow-y-auto pb-[env(safe-area-inset-bottom)] text-sm">{linhas(() => setListaAberta(false))}</ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
