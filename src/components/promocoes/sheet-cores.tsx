import { Wallet } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import { cn } from '@/lib/utils';
import { MOTIVO_COR as MOTIVO, rotuloMlb, type ItemPromocao } from '@/lib/promocoes';
import { detalheLiquido } from '@/lib/promocao-simulacao';
import { SEMAFORO_UI } from './contagem-semaforo';

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export function SheetCores({ item, simulado = false, onClose }: { item: ItemPromocao | null; simulado?: boolean; onClose: () => void }) {
  return (
    <Sheet open={item != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8">{formatarNomeProduto(item.titulo) || item.ml_item_id}</SheetTitle>
              <SheetDescription>
                {rotuloMlb(item)} · {simulado ? 'preço simulado' : 'preço da promoção'} {item.preco_avaliado != null ? fmtBRL(item.preco_avaliado) : '—'}
              </SheetDescription>
            </SheetHeader>
            <ul className="flex flex-col divide-y divide-border px-4">
              {item.projecao.map((c, i) => {
                const ui = SEMAFORO_UI[c.semaforo];
                // Mesmo "Você recebe por venda" de Publicados (card-voce-recebe), com a tarifa do preço exato.
                const d = detalheLiquido(c, item.preco_avaliado);
                return (
                  <li key={c.variation_id ?? i} className="flex flex-col gap-2 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate font-medium">{c.cor ?? 'Única'}</p>
                      {d && <StatusPill tone={ui.tone} title={ui.label}><ui.Icon className="size-3.5" aria-hidden />{ui.label}</StatusPill>}
                    </div>
                    {d ? (
                      <div className="rounded-md border bg-card p-2 shadow-sm">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Wallet className="size-3.5" aria-hidden /> Você recebe por venda
                        </div>
                        <p className="mb-1 text-xs text-muted-foreground">
                          preço <span className="font-medium text-foreground">{fmtBRL(item.preco_avaliado!)}</span>
                          {' · '}custo do produto <span className="font-medium text-foreground">{fmtBRL(c.custo!)}</span>
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-foreground">{fmtBRL(d.recebe)}</p>
                        <div className="text-[11px] tabular-nums text-muted-foreground">
                          <p>comissão −{fmtBRL(d.comissao)} ({pct(d.comissaoPct)}{c.comissao_fixa ? ` + ${fmtBRL(c.comissao_fixa)}` : ''})</p>
                          {d.imposto > 0 && <p>imposto −{fmtBRL(d.imposto)} ({pct(d.aliquotaPct)})</p>}
                          <p>{d.frete > 0 ? <>frete grátis ao comprador por sua conta −{fmtBRL(d.frete)}</> : 'sem frete por sua conta'}</p>
                        </div>
                        <p className={cn('mt-0.5 text-[11px]', d.lucro < 0 ? 'text-destructive' : 'text-success')}>
                          {d.lucro < 0 ? 'prejuízo ' : 'lucro '}
                          <span className="font-semibold">{fmtBRL(d.lucro)}</span>
                          {' · margem '}
                          <span className="font-semibold">{Math.round(d.margem * 100)}%</span>
                          {' · markup '}
                          <span className="font-semibold">{Math.round(d.markup * 100)}%</span>
                        </p>
                        {c.piso != null && <p className="mt-0.5 text-[11px] text-muted-foreground">mín. líquido {fmtBRL(c.piso)}</p>}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">{MOTIVO[c.motivo ?? ''] ?? 'Sem custo no PubliAI'}</span>
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
