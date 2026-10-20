import { ExternalLink, ImageOff } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { fmtBRL } from '@/lib/formato';
import type { AnuncioPatrocinado } from '@/lib/ads-campanhas';
import { fmtPontos, motivoLegivel } from './formato-campanha';

const NO_ADS: Record<string, { tom: StatusTone; txt: string }> = {
  active: { tom: 'success', txt: 'Ativo' },
  hold: { tom: 'neutral', txt: 'Em espera' },
  paused: { tom: 'neutral', txt: 'Pausado' },
};

function statusItem(item: AnuncioPatrocinado['item']): { tom: StatusTone | 'muted'; txt: string } {
  if (item == null) return { tom: 'muted', txt: 'Status indisponível' };
  if (item.status === 'active') return { tom: 'success', txt: 'Ativo' };
  if (item.status === 'paused' && item.subStatus.includes('out_of_stock')) return { tom: 'warning', txt: 'Pausado · sem estoque' };
  return { tom: 'warning', txt: item.status === 'paused' ? 'Pausado' : item.status };
}

/** Uma linha de MLB patrocinado. `equilibrio=false` no grupo "Fora do PubliAI" (sem margem calculada). */
export function LinhaMlb({ a, equilibrio = true }: { a: AnuncioPatrocinado; equilibrio?: boolean }) {
  const ads = NO_ADS[a.statusAds] ?? { tom: 'neutral' as const, txt: a.statusAds };
  const it = statusItem(a.item);
  const titulo = a.titulo ?? a.mlb;
  return (
    <li className="flex min-w-0 gap-3 py-2">
      {a.thumbnail
        ? <img src={a.thumbnail} alt={titulo} loading="lazy" width={40} height={40} className="h-10 w-10 shrink-0 rounded-md border border-border bg-muted object-cover" />
        : <div aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"><ImageOff className="h-4 w-4" /></div>}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="min-w-0">
          {a.permalink
            ? (
              <a href={a.permalink} target="_blank" rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="line-clamp-2 break-words">{titulo}</span>
                <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                <span className="sr-only">abre no Mercado Livre</span>
              </a>
            )
            : <span className="line-clamp-2 break-words font-medium">{titulo}</span>}
          <span className="block text-xs text-muted-foreground tabular-nums">{a.mlb}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">No Ads <StatusPill tone={ads.tom}>{ads.txt}</StatusPill></span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">No ML {it.tom === 'muted'
            ? <span>{it.txt}</span>
            : <StatusPill tone={it.tom}>{it.txt}</StatusPill>}</span>
          {a.item?.estoque != null && <span className="tabular-nums text-muted-foreground">Estoque {a.item.estoque}</span>}
          {a.item?.preco != null && <span className="tabular-nums">{fmtBRL(a.item.preco)}</span>}
          {equilibrio && (
            <span className="tabular-nums text-muted-foreground">
              {a.equilibrio.acosPct != null ? `até ${fmtPontos(Math.floor(a.equilibrio.acosPct * 10) / 10)}` : motivoLegivel(a.equilibrio.motivo)}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
