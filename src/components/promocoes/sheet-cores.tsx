import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusPill } from '@/components/ui/status-pill';
import { calcularMarkup } from '@/lib/markup';
import { fmtBRL, fmtMarkup } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import { MOTIVO_COR as MOTIVO, rotuloMlb, type ItemPromocao } from '@/lib/promocoes';
import { SEMAFORO_UI } from './contagem-semaforo';

export function SheetCores({ item, onClose }: { item: ItemPromocao | null; onClose: () => void }) {
  return (
    <Sheet open={item != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8">{formatarNomeProduto(item.titulo) || item.ml_item_id}</SheetTitle>
              <SheetDescription>
                {rotuloMlb(item)} · preço da promoção {item.preco_avaliado != null ? fmtBRL(item.preco_avaliado) : '—'}
              </SheetDescription>
            </SheetHeader>
            <ul className="flex flex-col divide-y divide-border px-4">
              {item.projecao.map((c, i) => {
                const ui = SEMAFORO_UI[c.semaforo];
                return (
                  <li key={c.variation_id ?? i} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.cor ?? 'Única'}</p>
                      {c.custo != null && <p className="text-xs text-muted-foreground tabular-nums">Custo {fmtBRL(c.custo)}</p>}
                      {c.piso != null && <p className="text-xs text-muted-foreground tabular-nums">Mín. líquido {fmtBRL(c.piso)}</p>}
                    </div>
                    {c.liquido != null && c.custo != null ? (
                      <div className="flex shrink-0 items-center gap-3 text-right">
                        <div className="tabular-nums">
                          <p className="font-medium">{fmtBRL(c.liquido)}</p>
                          <p className="text-xs text-muted-foreground">{fmtMarkup(calcularMarkup(c.liquido, c.custo).markup)}</p>
                        </div>
                        <StatusPill tone={ui.tone} title={ui.label}><ui.Icon className="size-3.5" aria-hidden />{ui.label}</StatusPill>
                      </div>
                    ) : (
                      <span className="shrink-0 text-sm text-muted-foreground">{MOTIVO[c.motivo ?? ''] ?? 'Sem custo no PubliAI'}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
