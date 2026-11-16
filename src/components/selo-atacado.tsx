// ADR-0196 emenda 2026-11-15 — selo de atacado na linha de Publicados. Neutro de propósito: mostra a configuração do
// PubliAI, não o que está no ML. Clicar abre o editor (só quando a edição é possível aqui).
import { Tags } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { amountComDesconto } from '@/lib/atacado';
import { MSG_ENTRE_LOTES, MSG_POR_COR, type SeloAtacado } from '@/lib/atacado-publicados';
import { fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';

export function SeloAtacadoBadge({ selo, precoBase, ehKit, onEditar }: {
  selo: SeloAtacado; precoBase: number | null; ehKit: boolean; onEditar?: () => void;
}) {
  const faixas = selo.tipo === 'faixas' ? selo.faixas : null;
  const rotulo = faixas ? `Atacado · ${faixas.length} faixa${faixas.length === 1 ? '' : 's'}`
    : selo.tipo === 'por_cor' ? 'Atacado por cor' : 'Atacado entre lotes';
  const unidade = ehKit ? 'kits' : 'un.';
  const editavel = !!faixas && !!onEditar;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={editavel ? `${rotulo} — editar atacado` : rotulo}
            onClick={(e) => { e.stopPropagation(); if (editavel) onEditar!(); }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground outline-none sm:whitespace-nowrap focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
              editavel ? 'cursor-pointer hover:bg-muted' : 'cursor-default border-dashed',
            )}
          >
            <Tags aria-hidden className="h-3 w-3" />
            {rotulo}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {faixas ? (
            <div className="space-y-0.5">
              {faixas.map((f) => (
                <p key={f.min_unidades} className="tabular-nums">
                  {f.min_unidades}+ {unidade}: −{String(f.desconto_pct).replace('.', ',')}%
                  {precoBase ? ` → ${fmtBRL(amountComDesconto(precoBase, f.desconto_pct))}` : ''}
                </p>
              ))}
              <p className="opacity-80">Valores estimados — confira no ML.{onEditar ? ' Clique para editar.' : ''}</p>
            </div>
          ) : selo.tipo === 'por_cor' ? MSG_POR_COR : MSG_ENTRE_LOTES}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
