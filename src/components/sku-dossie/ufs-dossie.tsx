import { MapPinned } from 'lucide-react';
import { MapaBrasil } from '@/components/faturamento/mapa-brasil';
import { EmptyState } from '@/components/ui/empty-state';
import { fmtBRL } from '@/lib/formato';
import type { DossieSku } from '@/lib/sku-dossie';
import { BlocoDossie } from './bloco-dossie';
import { pctBR } from './formato-dossie';

const TOP = 5;

/** Onde estão os compradores deste código no período: faturamento bruto por UF da order. A % é
 *  sobre o total com "sem localização", então tudo fecha em 100%. */
export function UfsDossie({ ufs, className }: { ufs: DossieSku['ufs']; className?: string }) {
  const ordem = Object.entries(ufs.valores).sort((a, b) => b[1] - a[1]);
  const total = ordem.reduce((s, [, v]) => s + v, 0) + ufs.semUf;
  const top = ordem.slice(0, TOP);
  const max = top[0]?.[1] ?? 1;

  return (
    <BlocoDossie id="dossie-ufs" titulo="Vendas por estado" relogio="Faturamento bruto por UF do comprador, no período escolhido" className={className}>
      {total <= 0 ? (
        <EmptyState icon={MapPinned} title="Nenhuma venda no período" className="flex-1"
          description="O mapa mostra onde estão os compradores assim que houver vendas neste período." />
      ) : (
        <div className="grid flex-1 items-center gap-5 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
          <div className="mx-auto w-full max-w-xs sm:max-w-none">
            <MapaBrasil valores={ufs.valores} formatar={fmtBRL} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <h3 id="dossie-ufs-top" className="text-xs font-medium text-muted-foreground">Maiores estados</h3>
            {top.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma venda com UF identificada.</p>
            ) : (
              <ol aria-labelledby="dossie-ufs-top" className="flex flex-col gap-2.5">
                {top.map(([uf, v]) => (
                  <li key={uf} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium">{uf}</span>
                    <span className="truncate text-right tabular-nums">{fmtBRL(v)}</span>
                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{pctBR(v / total)}</span>
                    <span className="col-span-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(v / max) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {ufs.semUf > 0 && (
              <p className="flex justify-between gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                <span>Sem localização</span>
                <span className="tabular-nums">{`${fmtBRL(ufs.semUf)} · ${pctBR(ufs.semUf / total)}`}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </BlocoDossie>
  );
}
