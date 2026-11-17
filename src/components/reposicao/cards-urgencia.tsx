import { AlertOctagon, AlertTriangle, Clock, ShoppingCart, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type { FiltroUrgencia, Visao } from '@/hooks/useReposicao';

const plural = (n: number, um: string, varios: string) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

/** Spec §3.2 + ruling R16: número principal em SKUs (em foreground, pelo contraste), apoio em produtos; a cor
 *  semântica fica na borda esquerda e no ícone. */
export function CardsUrgencia({ cards, ativo, onFiltro, ocultarVendaPerdida }: {
  cards: Visao['cards']; ativo: FiltroUrgencia; onFiltro: (f: FiltroUrgencia) => void; ocultarVendaPerdida: boolean;
}) {
  const itens: { filtro: FiltroUrgencia; titulo: string; numero: string; vazio: boolean; apoio: string[]; borda: string; icone: LucideIcon; cor: string }[] = [
    {
      filtro: 'ruptura', titulo: 'Ruptura', numero: plural(cards.ruptura.skus, 'SKU', 'SKUs'), vazio: cards.ruptura.skus === 0,
      apoio: [plural(cards.ruptura.produtos, 'produto', 'produtos'),
        ...(!ocultarVendaPerdida && cards.vendaPerdidaDia > 0 ? [`${fmtBRL(cards.vendaPerdidaDia)}/dia de venda perdida`] : [])],
      borda: 'border-l-danger', icone: AlertOctagon, cor: 'text-danger',
    },
    {
      filtro: 'vai_faltar', titulo: 'Vai faltar', numero: plural(cards.vai_faltar.skus, 'SKU', 'SKUs'), vazio: cards.vai_faltar.skus === 0,
      apoio: [plural(cards.vai_faltar.produtos, 'produto', 'produtos'), 'zera antes de um pedido feito hoje chegar'],
      borda: 'border-l-danger/60', icone: AlertTriangle, cor: 'text-danger/60',
    },
    {
      filtro: 'pedir_agora', titulo: 'Pedir agora', numero: plural(cards.pedir_agora.skus, 'SKU', 'SKUs'), vazio: cards.pedir_agora.skus === 0,
      apoio: [plural(cards.pedir_agora.produtos, 'produto', 'produtos')],
      borda: 'border-l-warning', icone: Clock, cor: 'text-warning',
    },
    {
      filtro: 'comprar', titulo: 'Sugerido para comprar', numero: `${fmtBRL(cards.sugerido.valor)} · ${fmtInt(cards.sugerido.unidades)} un.`,
      vazio: cards.sugerido.unidades === 0,
      apoio: [plural(cards.sugerido.fornecedores, 'fornecedor', 'fornecedores')],
      borda: 'border-l-primary', icone: ShoppingCart, cor: 'text-primary',
    },
  ];
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 md:pb-0">
      {itens.map((c) => {
        const on = ativo === c.filtro;
        return (
          <button
            key={c.filtro}
            type="button"
            aria-pressed={on}
            onClick={() => onFiltro(on ? 'precisa' : c.filtro)}
            className={cn(
              'flex min-w-[15rem] shrink-0 snap-start flex-col gap-1 rounded-xl border-l-4 bg-card px-4 py-3 text-left shadow-sm ring-1 ring-foreground/5 outline-none transition-shadow md:min-w-0',
              'hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring',
              c.borda, on && 'ring-2 ring-ring',
            )}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <c.icone aria-hidden className={cn('h-4 w-4', c.cor)} />{c.titulo}
            </span>
            {/* Card zerado perde peso: o olho vai para onde há o que pedir. */}
            {/* Sem cn(): o twMerge lê text-h2 como cor e o derruba junto com a cor do número. */}
            <span className={`text-h2 tabular-nums ${c.vazio ? 'text-muted-foreground' : 'text-foreground'}`}>{c.numero}</span>
            {c.apoio.map((a) => <span key={a} className="text-caption tabular-nums">{a}</span>)}
          </button>
        );
      })}
    </div>
  );
}
