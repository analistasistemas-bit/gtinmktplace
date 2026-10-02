import { ArrowDown, ArrowUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { delta, type KpisVitrine } from '@/lib/vitrine';

const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

function Delta({ atual, anterior }: { atual: number | null; anterior: number | null }) {
  const d = delta(atual, anterior);
  if (d == null) return null;
  const Seta = d >= 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', d >= 0 ? 'text-success' : 'text-danger')}>
      <Seta className="size-3" aria-hidden />{Math.abs(d * 100).toFixed(1).replace('.', ',')}%
      <span className="sr-only"> contra o período anterior</span>
    </span>
  );
}

function Card({ titulo, valor, atual, anterior }: { titulo: string; valor: string | null; atual: number | null; anterior: number | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <div className="flex items-baseline gap-2">
        {valor == null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help text-2xl font-semibold text-muted-foreground" aria-label="Sem dado: cobertura insuficiente">—</button>
            </TooltipTrigger>
            <TooltipContent>cobertura insuficiente</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-2xl font-semibold tabular-nums">{valor}</span>
        )}
        <Delta atual={atual} anterior={anterior} />
      </div>
    </div>
  );
}

export function PulsoVitrine({ kpis, frases }: { kpis: KpisVitrine; frases: string[] }) {
  const { atual: a, anterior: b } = kpis;
  return (
    <section aria-label="Resumo" className="flex flex-col gap-3">
      <TooltipProvider>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card titulo="Visitas" valor={a.visitas == null ? null : fmtInt(a.visitas)} atual={a.visitas} anterior={b.visitas} />
          <Card titulo="Conversão" valor={a.conversao == null ? null : pct(a.conversao)} atual={a.conversao} anterior={b.conversao} />
          <Card titulo="Venda por visita" valor={a.vendaPorVisita == null ? null : fmtBRL(a.vendaPorVisita)} atual={a.vendaPorVisita} anterior={b.vendaPorVisita} />
        </div>
      </TooltipProvider>
      {a.avisoCobertura && <p className="text-xs text-muted-foreground">Dados de {Math.round(a.cobertura * 100)}% dos dias medidos.</p>}
      {frases.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {frases.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
    </section>
  );
}
